const fs = require('fs');
const path = require('path');

const MODEL_URL = 'https://huggingface.co/onnx-community/distilbert-multilingual-toxicity-classifier-ONNX/resolve/main/';
const MODEL_DIR = path.resolve(__dirname, '../models/distilbert-multilingual-toxicity');
const ONNX_DIR = path.join(MODEL_DIR, 'onnx');

const FILES = [
  ['config.json', 'config.json'],
  ['tokenizer.json', 'tokenizer.json'],
  ['tokenizer_config.json', 'tokenizer_config.json'],
  ['special_tokens_map.json', 'special_tokens_map.json'],
  ['vocab.txt', 'vocab.txt'],
  ['onnx/model_int8.onnx', 'onnx/model_int8.onnx']
];

async function download(url, destination) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while downloading ${url}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error(`Empty response while downloading ${url}`);

  const temporary = `${destination}.tmp`;
  fs.writeFileSync(temporary, buffer, { mode: 0o644 });
  fs.renameSync(temporary, destination);
}

async function main() {
  fs.mkdirSync(ONNX_DIR, { recursive: true });

  for (const [remote, relative] of FILES) {
    const destination = path.join(MODEL_DIR, relative);
    if (fs.existsSync(destination)) {
      console.log(`[moderation-model] exists: ${relative}`);
      continue;
    }

    fs.mkdirSync(path.dirname(destination), { recursive: true });
    console.log(`[moderation-model] downloading: ${remote}`);
    await download(`${MODEL_URL}${remote}`, destination);
  }

  console.log('[moderation-model] Local multilingual toxicity model is ready.');
}

main().catch(error => {
  console.error(`[moderation-model] ${error.message}`);
  process.exit(1);
});
