const tf = require('@tensorflow/tfjs');
const nsfwjs = require('nsfwjs');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { findProfanity } = require('./utils/profanityFilter');


let modelInstance = null;
let isModelLoading = false;
const loadWaiters = [];

/**
 * Singleton loader for MobileNetV2 NSFW model with concurrent execution protection.
 */
async function getModel() {
  if (modelInstance) return modelInstance;

  if (isModelLoading) {
    return new Promise((resolve, reject) => {
      loadWaiters.push({ resolve, reject });
    });
  }

  isModelLoading = true;
  try {
    console.log('[MODERATION]: Initializing neural network model in local memory...');
    modelInstance = await nsfwjs.load();
    console.log('[MODERATION]: Model loaded successfully.');
    loadWaiters.forEach(w => w.resolve(modelInstance));
    return modelInstance;
  } catch (err) {
    console.error('[MODERATION FATAL]: Could not load NSFW model:', err);
    loadWaiters.forEach(w => w.reject(err));
    throw err;
  } finally {
    isModelLoading = false;
    loadWaiters.length = 0;
  }
}

/**
 * Validates an image buffer or base64 data string against explicit content policies.
 * Employs strict fail-closed security: any parsing failure rejects the image.
 *
 * @param {Buffer|string} imageInput 
 * @returns {Promise<{safe: boolean, reason?: string, scores?: object}>}
 */
async function isImageSafeLocally(imageInput) {
  if (!imageInput) {
    return { safe: false, reason: 'Empty image payload.' };
  }

  let imageBuffer;
  try {
    if (typeof imageInput === 'string' && imageInput.startsWith('data:image/')) {
      const parts = imageInput.split(',');
      if (parts.length < 2) {
        return { safe: false, reason: 'Malformed base64 image data.' };
      }
      imageBuffer = Buffer.from(parts[1], 'base64');
    } else if (Buffer.isBuffer(imageInput)) {
      imageBuffer = imageInput;
    } else {
      return { safe: false, reason: 'Unrecognized image data type.' };
    }

    // Sanitize and re-encode to raw 224x224 RGB pixels using Sharp
    const { data, info } = await sharp(imageBuffer)
      .resize(224, 224, { fit: 'cover' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const numChannels = 3;
    const numPixels = info.width * info.height;
    const values = new Int32Array(numPixels * numChannels);

    for (let i = 0; i < values.length; i++) {
      values[i] = data[i];
    }

    const model = await getModel();

    // Dispose the input tensor explicitly: tf.tidy() does not track tensors
    // across an awaited promise, so the old code leaked memory on every upload.
    const tensor = tf.tensor3d(values, [info.height, info.width, numChannels], 'int32');
    let predictions;
    try {
      predictions = await model.classify(tensor);
    } finally {
      tensor.dispose();
    }

    const scoreMap = {};
    for (const p of predictions) {
      scoreMap[p.className] = p.probability;
    }

    // Safety Decision Gates
    const isPorn = (scoreMap['Porn'] || 0) > 0.40;
    const isHentai = (scoreMap['Hentai'] || 0) > 0.40;
    const isExcessivelySexy = (scoreMap['Sexy'] || 0) > 0.75;

    if (isPorn || isHentai || isExcessivelySexy) {
      return {
        safe: false,
        reason: 'Image not allowed: inappropriate or explicit content detected.',
        scores: scoreMap
      };
    }

    return { safe: true, scores: scoreMap };

  } catch (err) {
    console.error('[LOCAL MODERATION ERROR]:', err.message);
    // FAIL-CLOSED: Reject corrupted or malicious files
    return {
      safe: false,
      reason: 'Image inspection failed. The file may be damaged or invalid.'
    };
  }
}



// -----------------------------------------------------------------------------
// Text moderation
// -----------------------------------------------------------------------------
// Layer 1 is deliberately deterministic and synchronous: common English and
// Italian profanity / sexual-explicit terms are blocked before any ML work.
// The list is intentionally kept small and high-signal; the model handles
// contextual toxicity, insults, threats and hate speech.
//
// Layer 2 uses a local ONNX multilingual toxicity classifier. The model is
// never fetched at request time: env.allowRemoteModels=false and
// local_files_only=true. Provision the model once with:
//   npm run setup:moderation
//
// Model: onnx-community/distilbert-multilingual-toxicity-classifier-ONNX
// It covers English, Italian and additional languages. See:
// https://huggingface.co/onnx-community/distilbert-multilingual-toxicity-classifier-ONNX
const TEXT_MODEL_DIR = path.resolve(
  process.env.TEXT_MODERATION_MODEL_PATH || path.join(__dirname, '../models/distilbert-multilingual-toxicity')
);

const MAX_MODERATION_TEXT_LENGTH = 5000;
// The multilingual DistilBERT classifier over-triggers on ordinary Italian
// criticism ("assurdo", "ridicolo", ...). 0.78 rejected normal feedback, so the
// default is now much stricter. Override with TEXT_MODERATION_THRESHOLD.
const TOXICITY_THRESHOLD = Number.isFinite(Number(process.env.TEXT_MODERATION_THRESHOLD))
  ? Number(process.env.TEXT_MODERATION_THRESHOLD)
  : 0.93;

// The model is unreliable on very short strings (a single word scores randomly
// high). Explicit profanity is already caught by layer 1, so strings with fewer
// words than this skip the model entirely. This also removes the per-field
// inference cost for form values such as "2nd floor", or "BSc".
const MIN_WORDS_FOR_MODEL = Number.isFinite(Number(process.env.TEXT_MODERATION_MIN_WORDS))
  ? Number(process.env.TEXT_MODERATION_MIN_WORDS)
  : 4;

// Everyday words of criticism / surprise that are NOT abuse. They are removed
// from the text before it reaches the model so they cannot trigger a rejection
// on their own. Real insults stay in TEXT_EXPLICIT_TERMS (layer 1).
const MODEL_NEUTRAL_WORDS = [
  'assurdo', 'assurda', 'assurdi', 'assurde', 'assurdita',
  'ridicolo', 'ridicola', 'ridicoli', 'ridicole',
  'inaccettabile', 'inaccettabili', 'pessimo', 'pessima', 'pessimi', 'pessime',
  'terribile', 'terribili', 'orribile', 'orribili', 'vergognoso', 'vergognosa',
  'pazzesco', 'pazzesca', 'folle', 'assurd', 'absurd', 'ridiculous', 'terrible', 'awful', 'horrible'
];
const MODEL_NEUTRAL_RE = new RegExp(`\\b(?:${MODEL_NEUTRAL_WORDS.join('|')})\\b`, 'gi');

// Small in-memory cache so identical text (retries, double submits) is never
// classified twice.
const RESULT_CACHE = new Map();
const RESULT_CACHE_MAX = 500;
function cacheGet(key) { return RESULT_CACHE.get(key); }
function cacheSet(key, value) {
  if (RESULT_CACHE.size >= RESULT_CACHE_MAX) RESULT_CACHE.delete(RESULT_CACHE.keys().next().value);
  RESULT_CACHE.set(key, value);
}

const TEXT_EXPLICIT_TERMS = [
  // English high-signal profanity / sexual-explicit vocabulary.
  'fuck', 'fucking', 'fucker', 'motherfucker', 'shit', 'bullshit', 'bitch',
  'asshole', 'dick', 'pussy', 'cunt', 'cock', 'slut', 'whore', 'porn',
  'pornography', 'nigger', 'nigga', 'faggot', 'retard',
  // Italian high-signal profanity / sexual-explicit vocabulary.
  'cazzo', 'cazzi', 'cazzata', 'cazzate', 'coglione', 'coglioni',
  'stronzo', 'stronza', 'stronzi', 'merda', 'puttana', 'puttane',
  'troia', 'troie', 'vaffanculo', 'bastardo', 'bastarda', 'bastardi',
  'figlio di puttana', 'fica', 'fregna', 'minchia', 'porno', 'pornografia',
  // A few common multilingual high-signal terms.
  'kurwa', 'blyat', 'puta', 'puto', 'joder', 'hijo de puta'
];

function normalizeModerationText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // Collapse common leetspeak only where it is useful for profanity
    // detection; this is not intended to be a general transliteration layer.
    .replace(/[0@]/g, 'o')
    .replace(/[1!|]/g, 'i')
    .replace(/[3]/g, 'e')
    .replace(/[4]/g, 'a')
    .replace(/[5$]/g, 's')
    .replace(/[7]/g, 't')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const EXPLICIT_TERM_PATTERNS = TEXT_EXPLICIT_TERMS
  .map(term => normalizeModerationText(term))
  .filter(Boolean)
  .sort((a, b) => b.length - a.length)
  .map(term => new RegExp(`(?:^|\\s)${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|\\s)`, 'i'));

function scanTextLayerOne(text) {
  const hit = findProfanity(text);
  if (!hit) return null;

  return {
    layer: 'regex',
    reason: 'Explicit or abusive language is not allowed.'
  };
}

let textPipeline = null;
let textModelLoadPromise = null;
let textInferenceTail = Promise.resolve();

async function getTextModerationPipeline() {
  if (textPipeline) return textPipeline;
  if (textModelLoadPromise) return textModelLoadPromise;

  textModelLoadPromise = (async () => {
    if (!fs.existsSync(TEXT_MODEL_DIR)) {
      const missing = new Error(
        `Local text moderation model is missing at ${TEXT_MODEL_DIR}. Run "npm run setup:moderation".`
      );
      missing.code = 'MODERATION_MODEL_MISSING';
      throw missing;
    }

    const { env, pipeline } = await import('@huggingface/transformers');
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = path.dirname(TEXT_MODEL_DIR);

    const modelId = path.basename(TEXT_MODEL_DIR);
    const classifier = await pipeline('text-classification', modelId, {
      local_files_only: true,
      top_k: null,
      dtype: 'int8'
    });

    textPipeline = classifier;
    return classifier;
  })();

  try {
    return await textModelLoadPromise;
  } finally {
    textModelLoadPromise = null;
  }
}

function queueTextInference(task) {
  const run = textInferenceTail.then(task, task);
  textInferenceTail = run.catch(() => undefined);
  return run;
}

async function isTextSafeLocally(textInput) {
  if (textInput == null || String(textInput).trim() === '') {
    return { safe: true };
  }

  const text = String(textInput);
  if (text.length > MAX_MODERATION_TEXT_LENGTH) {
    return {
      safe: false,
      reason: `Text exceeds the ${MAX_MODERATION_TEXT_LENGTH}-character moderation limit.`,
      layer: 'input'
    };
  }

  const layerOne = scanTextLayerOne(text);
  if (layerOne) {
    return { safe: false, ...layerOne };
  }

  // Layer 2 (ML) only for real prose. Short values, numbers, dates, etc. pass
  // after the regex layer.
  const modelText = text.replace(MODEL_NEUTRAL_RE, ' ').replace(/\s+/g, ' ').trim();
  const wordCount = (modelText.match(/\p{L}{2,}/gu) || []).length;
  if (wordCount < MIN_WORDS_FOR_MODEL) {
    return { safe: true, layer: 'regex' };
  }

  const cacheKey = modelText.toLowerCase();
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const classifier = await getTextModerationPipeline();
    const predictions = await queueTextInference(() => classifier(modelText, {
      truncation: true,
      max_length: 256
    }));

    const list = Array.isArray(predictions) ? predictions : [predictions];
    const toxic = list.find(item => String(item?.label || '').toLowerCase() === 'toxic');
    const toxicScore = Number(toxic?.score || 0);

    if (toxicScore >= TOXICITY_THRESHOLD) {
      // Score only (never the text) so false positives can be tuned from logs.
      console.warn(`[TEXT MODERATION]: rejected by model, score=${toxicScore.toFixed(3)}, threshold=${TOXICITY_THRESHOLD}, words=${wordCount}`);
      const rejected = {
        safe: false,
        reason: 'Your text was flagged as potentially offensive. Please rephrase it and try again.',
        layer: 'model',
        score: toxicScore
      };
      cacheSet(cacheKey, rejected);
      return rejected;
    }

    const accepted = { safe: true, layer: 'model', score: toxicScore };
    cacheSet(cacheKey, accepted);
    return accepted;
  } catch (err) {
    console.error('[LOCAL TEXT MODERATION ERROR]:', err.message);

    // The ONNX model is a separate download (npm run setup:moderation). If it
    // was never provisioned (typical on a fresh local checkout) every single
    // text submission used to be rejected. Layer 1 (profanity filter) has
    // already run above, so outside production we degrade to regex-only.
    // In production this stays fail-closed unless explicitly allowed.
    if (
      err.code === 'MODERATION_MODEL_MISSING' &&
      (process.env.NODE_ENV !== 'production' || process.env.TEXT_MODERATION_ALLOW_REGEX_ONLY === 'true')
    ) {
      return { safe: true, layer: 'regex-only' };
    }

    // Fail closed for user-generated content: if the second layer cannot be
    // evaluated, do not silently downgrade to regex-only moderation.
    return {
      safe: false,
      reason: 'Text moderation is temporarily unavailable. Please try again.',
      layer: 'model-error'
    };
  }
}

/**
 * Loads both models at boot so the first registration / upload does not pay
 * the multi-second model load. Never throws: a failure just means lazy loading.
 */
async function warmUpModeration() {
  try {
    await getModel();
    console.log('[MODERATION]: image model warmed up.');
  } catch (err) {
    console.error('[MODERATION WARM-UP]: image model not ready:', err.message);
  }
  try {
    await getTextModerationPipeline();
    await isTextSafeLocally('This is a short warm up sentence for the classifier.');
    console.log('[MODERATION]: text model warmed up.');
  } catch (err) {
    console.error('[MODERATION WARM-UP]: text model not ready:', err.message);
  }
}

module.exports = {
  isImageSafeLocally,
  isTextSafeLocally,
  warmUpModeration
};
