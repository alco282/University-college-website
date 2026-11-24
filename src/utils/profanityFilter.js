'use strict';

/**
 * Filtro deterministico per volgarità e bestemmie (livello 1 della moderazione).
 *
 * Resiste a: maiuscole, accenti, punteggiatura attaccata ("cazzo!!!"),
 * spazi o punti dentro la parola ("ca zzo", "c a z z o", "c.a.z.z.o"),
 * lettere ripetute ("cazzzzo"), leetspeak ("c@zz0", "$hit"), caratteri
 * invisibili e lettere cirilliche/greche che somigliano a quelle latine.
 *
 * Per evitare falsi positivi ("Scunthorpe problem"):
 *  - le parole intere si confrontano come parole, non come sottostringhe;
 *  - le radici (es. "stronz") valgono solo all'INIZIO di una parola;
 *  - le parole legittime che contengono una radice sono in SAFE_WORDS;
 *  - gli spazi dentro una parola si ricuciono solo per termini lunghi e
 *    senza ambiguità (WINDOW_TERMS).
 *
 * Per estendere il filtro modifica solo gli elenchi qui sotto.
 */

// -----------------------------------------------------------------------------
// Elenchi (tutto in minuscolo, senza accenti)
// -----------------------------------------------------------------------------

// Parole intere bloccate.
const EXACT_TERMS = [
  '2g1c', 'aborto', 'acrotomophilia', 'action', 'alabama', 'alaskan', 'albert',
  'allupato', 'amador', 'ammucchiata', 'amor', 'anal', 'anale', 'analritter',
  'anilingus', 'anus', 'apeshit', 'aranha', 'ariano', 'arrapato', 'arrusa',
  'arruso', 'arsch', 'arschficker', 'arschlecker', 'arschloch', 'arsehole',
  'asesinato', 'asno', 'ass', 'assassina', 'assassino', 'assatanato', 'asshole',
  'assmunch', 'auto', 'autoerotic', 'babeland', 'baby', 'bagascia', 'bagassa',
  'bagnarsi', 'baiser', 'balalao', 'baldracca', 'ball', 'balle', 'bander',
  'bang', 'bangbros', 'bangbus', 'bareback', 'barely', 'barenaked', 'bastard',
  'bastarda', 'bastardo', 'bastinado', 'batter', 'battere', 'battona', 'bbw',
  'bdsm', 'beaner', 'beaners', 'beastiality', 'beaver', 'belino', 'bestia',
  'bestiality', 'bicha', 'bifilo', 'big', 'biga', 'bigornette', 'bimbo',
  'bimbos', 'birdlock', 'biscate', 'bissexual', 'bitch', 'bitches', 'bite',
  'bitte', 'black', 'bloblos', 'blonde', 'blow', 'blowjob', 'blumpkin',
  'boceta', 'bocchinara', 'bocchino', 'bofilo', 'boia', 'boiata', 'bolla',
  'bollera', 'bollocks', 'bondage', 'boner', 'bonze', 'boob', 'boobs',
  'booty', 'bordel', 'bordello', 'borracha', 'bosta', 'bourre', 'bourree',
  'brackmard', 'branlage', 'branler', 'branlette', 'branleur', 'branleuse',
  'bratze', 'braulio', 'breasts', 'brinca', 'brouter', 'brown', 'bucaiolo',
  'budiulo', 'buena', 'bukkake', 'bulldyke', 'bullet', 'bullshit', 'bumbum',
  'bumsen', 'bung', 'bunghole', 'burro', 'busone', 'busty', 'butt',
  'buttcheeks', 'butthole', 'buttons', 'cabrao', 'cabron', 'caca',
  'caciocappella', 'cacete', 'cadavere', 'cagare', 'cagata', 'cagna',
  'call', 'camel', 'camgirl', 'camisinha', 'camslut', 'camwhore', 'can',
  'cane', 'cantante', 'caralho', 'carl', 'carpet', 'carpetmuncher', 'casci',
  'cazzata', 'cazzate', 'cazzimma', 'cazzo', 'cazzone', 'cesso', 'chatte',
  'checca', 'cheque', 'chiappa', 'chiavare', 'chiavata', 'chiasse', 'chier',
  'chiottes', 'chochota', 'chupada', 'chupapollas', 'chupar', 'chupeton',
  'cialis', 'ciospo', 'circlejerk', 'ciucciami', 'clamps', 'cleaver',
  'cleveland', 'clit', 'clito', 'clitoris', 'clover', 'clusterfuck', 'cocaina',
  'cock', 'cocks', 'coglione', 'coglioni', 'coito', 'colhoes', 'comer',
  'con', 'cona', 'concha', 'connard', 'connasse', 'conne', 'consolo',
  'cono', 'coon', 'coons', 'coprofagia', 'coprolagnia', 'coprophilia', 'core',
  'cornhole', 'corno', 'cornuto', 'couilles', 'cowgirl', 'cozza', 'cramouille',
  'creampie', 'cresson', 'cul', 'culattina', 'culattone', 'culo', 'cum',
  'cumming', 'cumshot', 'cumshots', 'cunnilingus', 'cunt', 'damn', 'darkie',
  'daterape', 'deconne', 'deconner', 'deep', 'deepthroat', 'dendrophilia',
  'dick', 'dildo', 'dingleberries', 'dingleberry', 'ditalino', 'dodel',
  'doggie', 'doggiestyle', 'doggy', 'doggystyle', 'dolcett', 'domination',
  'dominatrix', 'dommes', 'dong', 'donkey', 'donut', 'double', 'dp',
  'drogas', 'dry', 'dum', 'dvda', 'eat', 'ecchi', 'ejaculation', 'emmerdant',
  'emmerder', 'emmerdeur', 'emmerdeuse', 'encule', 'enculee', 'enculeur',
  'enculeurs', 'enfoire', 'enfoiree', 'erotic', 'erotism', 'escort', 'esperma',
  'esporra', 'etron', 'eunuch', 'fag', 'faggot', 'fava', 'fecal', 'felch',
  'fellatio', 'feltch', 'femdom', 'femminuccia', 'fetish', 'fica', 'fiesta',
  'figa', 'figging', 'figlio', 'figone', 'filho', 'fille', 'fils', 'finocchio',
  'fingerbang', 'fingering', 'fisting', 'fittchen', 'flittchen', 'foda',
  'foder', 'folle', 'follador', 'follar', 'foot', 'footjob', 'fottere',
  'fottersi', 'fotze', 'foutre', 'fracicone', 'frango', 'fratze', 'fregna',
  'frocio', 'froscio', 'frotting', 'fuck', 'fucker', 'fuckin', 'fucking',
  'fucktards', 'fudge', 'fudgepacker', 'futanari', 'gag', 'gang', 'gangbang',
  'gay', 'genitals', 'gerbe', 'gerber', 'giant', 'gilipichis', 'gilipollas',
  'goatcx', 'goatse', 'god', 'gokkun', 'golden', 'goldone', 'goodpoop',
  'goregasm', 'gouine', 'gozar', 'gravy', 'grelho', 'grogniasse', 'grope',
  'group', 'guardone', 'gueule', 'guro', 'hackfresse', 'hacer', 'haciendo',
  'hand', 'handjob', 'hard', 'hardcore', 'hentai', 'heroina', 'heterosexual',
  'hija', 'hijaputa', 'hijo', 'hijoputa', 'hole', 'homem', 'homoerotic',
  'homoerotico', 'homosexual', 'honkey', 'hooker', 'horny', 'hump', 'humping',
  'hure', 'hurensohn', 'idiota', 'imbecil', 'imbecille', 'incazzarsi',
  'incest', 'incoglionirsi', 'infame', 'infierno', 'ingoio', 'intercourse',
  'ische', 'jack', 'jacket', 'jail', 'jailbait', 'jelly', 'jerk', 'jigaboo',
  'jiggaboo', 'jiggerboo', 'jilipollas', 'jizz', 'jouir', 'juggs', 'kackbratze',
  'kacke', 'kacken', 'kackwurst', 'kampflesbe', 'kanake', 'kapullo', 'kicking',
  'kike', 'kimme', 'kinbaku', 'kinkster', 'kinky', 'knobbing', 'knockers',
  'ladra', 'ladro', 'lameculos', 'leather', 'leccaculo', 'lecchino', 'legal',
  'lemon', 'lesbica', 'licking', 'lips', 'livesex', 'load', 'lofare',
  'loffa', 'loffare', 'lolita', 'love', 'lovemaking', 'lummel', 'lurida',
  'lurido', 'maciza', 'macizorra', 'madre', 'maiala', 'maiale', 'maldita',
  'maldito', 'male', 'malpt', 'mama', 'mamada', 'mannaggia', 'marica',
  'maricon', 'mariconazo', 'masturbate', 'masturbating', 'masturbation',
  'menage', 'merda', 'merdata', 'merde', 'merdeuse', 'merdeux', 'merdoso',
  'meuf', 'mierda', 'mignotta', 'milf', 'minchia', 'minchione', 'missionary',
  'mona', 'mong', 'mopse', 'morgenlatte', 'mose', 'motherfucker', 'muff',
  'muffdiver', 'muffdiving', 'mufti', 'muncher', 'muschi', 'mussa', 'nackt',
  'nambla', 'nave', 'nawashi', 'nazi', 'neger', 'negro', 'neonazi', 'nerchia',
  'nigga', 'nigger', 'nimphomania', 'nippel', 'nipple', 'nipples', 'nique',
  'nog', 'nsfw', 'nude', 'nudity', 'nutte', 'nutten', 'nympho', 'nymphomania',
  'octopussy', 'omorashi', 'onanieren', 'oral', 'orgasm', 'orgasmo', 'orgasmus',
  'orgy', 'orina', 'packer', 'padulo', 'paedophile', 'paja', 'paki',
  'palle', 'palloso', 'palucher', 'paneleiro', 'panties', 'panty', 'papi',
  'pariu', 'party', 'passar', 'patacca', 'patonza', 'pau', 'pecorina',
  'pedale', 'pede', 'pedo', 'pedobear', 'pedophile', 'pegging', 'peidar',
  'pendejo', 'penis', 'pervertido', 'pesce', 'peter', 'pezon', 'phone',
  'picio', 'piercing', 'pig', 'pikey', 'pimmel', 'pimpern', 'pincare',
  'pinche', 'pinkeln', 'pinto', 'pippa', 'pippone', 'pirla', 'pis', 'pisciare',
  'piscio', 'pisello', 'piss', 'pisse', 'pissen', 'pisser', 'pissing',
  'pisspig', 'pistolotto', 'playboy', 'pleasure', 'pocket', 'pole', 'pomiciare',
  'pompa', 'pompino', 'ponyplay', 'poof', 'poon', 'poontang', 'poop',
  'poopchute', 'popel', 'poppen', 'porca', 'porco', 'porn', 'pornography',
  'porno', 'position', 'potta', 'pouffiasse', 'pousse-crotte', 'power',
  'prince', 'prostituta', 'pthc', 'pubes', 'punch', 'punany', 'puppami',
  'pussy', 'puta', 'putain', 'pute', 'puttana', 'quaglia', 'queaf', 'queef',
  'quim', 'race', 'racista', 'raghead', 'raging', 'ramera', 'ramoner',
  'rape', 'raping', 'rapist', 'recchione', 'rectum', 'regina', 'restraint',
  'reudig', 'rimjob', 'rimming', 'rincoglionire', 'rizzarsi', 'rompiballe',
  'rompipalle', 'rosette', 'rosy', 'ruffiano', 'rusty', 's&m', 'sacanagem',
  'saco', 'sadico', 'sadism', 'salchichas', 'salope', 'santorum', 'sbattere',
  'sbattersi', 'sborra', 'sborrata', 'sborrone', 'sbrodolata', 'scabracke',
  'scat', 'schifosa', 'schifoso', 'schlampe', 'schlong', 'schnackeln',
  'schwanzlutscher', 'schwuchtel', 'scissoring', 'scopare', 'scopata',
  'scorreggiare', 'scuola', 'sega', 'semen', 'sex', 'sexcam', 'sexo',
  'sexual', 'sexuality', 'sexually', 'sexy', 'shaved', 'shemale', 'shibari',
  'shit', 'shitblimp', 'shitty', 'shota', 'shower', 'showers', 'shrimping',
  'skeet', 'slanteye', 'slinguare', 'slinguata', 'slut', 'smandrappata',
  'smoker', 'smut', 'snatch', 'snowballing', 'soccia', 'socmel', 'sodomize',
  'sodomy', 'soplagaitas', 'soplapollas', 'sorca', 'spagnola', 'spastic',
  'spic', 'splooge', 'spompinare', 'spooge', 'sporca', 'sporco', 'spread',
  'spunk', 'squirting', 'sticchio', 'strap', 'strapon', 'strappado', 'strip',
  'stronza', 'stronzata', 'stronzo', 'suce', 'succhiami', 'succhione',
  'suck', 'sucks', 'suicide', 'sultry', 'sveltina', 'sverginare', 'swastika',
  'swinger', 'tainted', 'tanche', 'tapette', 'tarzanello', 'taste', 'tea',
  'terrone', 'testa', 'tetas', 'tette', 'teuch', 'throating', 'thumbzilla',
  'tia', 'tied', 'tight', 'tirare', 'tit', 'tits', 'tittchen', 'titten',
  'titties', 'titty', 'tongue', 'topa', 'topless', 'torneira', 'tosser',
  'towelhead', 'travesti', 'tribadism', 'tringler', 'trio', 'trique', 'troia',
  'trombare', 'troncher', 'trou', 'tub', 'tubgirl', 'turlute', 'tushy',
  'twat', 'twink', 'twinkie', 'undressing', 'upskirt', 'urethra', 'urophilia',
  'vacca', 'vadia', 'vaffanculo', 'vai', 'vai-te', 'vangare', 'veado',
  'venus', 'verga', 'verme', 'vete', 'viagra', 'vibrador', 'vibrator',
  'violet', 'vogeln', 'vollpfosten', 'vorarephilia', 'voyeur', 'voyeurweb',
  'voyuer', 'vulva', 'waffle', 'wand', 'wank', 'wet', 'wetback', 'white',
  'whore', 'wichse', 'wichsen', 'wichser', 'worldsex', 'wrapping', 'xana',
  'xochota', 'yaoi', 'yellow', 'yiffy', 'zigounette', 'zinne', 'zizi',
  'zoccola', 'zoophilia'
];

// Radici: bloccano ogni parola che INIZIA così.
const PREFIX_TERMS = [
  'stronz', 'coglion', 'cazzat', 'cazzon', 'puttan', 'minchia', 'minchion', 'vaffancul',
  'merd', 'fottut', 'inculat', 'inculo', 'bastard', 'fuck', 'motherfuck', 'shitt',
  'shith', 'shits', 'bitch', 'slutt', 'whore', 'porno', 'nigger', 'nigga', 'faggot',
  'kurw', 'blyat', 'sborr'
];

// Parole legittime che iniziano con una radice bloccata.
const SAFE_WORDS = new Set([
  'puttanesca', 'cazzuola', 'bastardino'
]);

// Termini lunghi e non ambigui: si bloccano anche se spezzati da spazi
const WINDOW_TERMS = new Set([
  'cazzo', 'cazzi', 'cazzata', 'cazzate', 'cazzone', 'coglione', 'coglioni', 'stronzo',
  'stronza', 'stronzi', 'stronzata', 'merda', 'puttana', 'puttane', 'troia', 'minchia',
  'vaffanculo', 'bastardo', 'bastarda', 'fuck', 'fucking', 'fucker', 'bitch',
  'asshole', 'motherfucker', 'whore', 'pussy', 'nigger', 'faggot', 'kurwa', 'blyat'
]);

// Bestemmie: un termine sacro vicino a un insulto (in qualsiasi ordine)
const SACRED = ['dio', 'iddio', 'madonna', 'cristo', 'gesu', 'gesucristo'];
const INSULTS = [
  'cane', 'can', 'porco', 'porca', 'maiale', 'maiala', 'boia', 'bestia', 'bastardo',
  'bastarda', 'ladro', 'ladra', 'merda', 'stronzo', 'stronza', 'schifoso', 'schifosa',
  'infame', 'cagna', 'puttana', 'troia', 'zoccola', 'lurido', 'lurida', 'maledetto',
  'maledetta', 'fottuto', 'fottuta', 'cornuto', 'assassino', 'assassina', 'verme',
  'sporco', 'sporca', 'bugiardo', 'bugiarda', 'impestato', 'impestata'
];
// "porco di dio", "porca di madonna"
const PREFIX_INSULTS_WITH_DI = new Set(['porco', 'porca', 'maledetto', 'maledetta']);

// -----------------------------------------------------------------------------
// Normalizzazione
// -----------------------------------------------------------------------------
const BOUNDARY = '\u0001';

const HOMOGLYPHS = {
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y', 'і': 'i',
  'ѕ': 's', 'ο': 'o', 'ε': 'e', 'α': 'a', 'ι': 'i', 'ν': 'v', 'κ': 'k'
};
const LEET = { '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '€': 'e' };

const EDGE_PUNCT = /^[.,;:!?"'`()\[\]{}<>*_~\-–—\/\\]+|[.,;:!?"'`()\[\]{}<>*_~\-–—\/\\]+$/gu;

function mapLeetToken(token) {
  if (!/\p{L}/u.test(token)) return token;
  const stripped = token.replace(EDGE_PUNCT, '');
  return stripped.replace(/[0-9!|@$€]/g, ch => LEET[ch] || ch);
}

function normalize(value) {
  let text = String(value || '')
    .normalize('NFKC')
    .replace(/[\u200b-\u200f\u2060\ufeff\u00ad]/g, '')
    .toLocaleLowerCase()
    .replace(/[\u0430\u0435\u043e\u0440\u0441\u0445\u0443\u0456\u0455\u03bf\u03b5\u03b1\u03b9\u03bd\u03ba]/g, ch => HOMOGLYPHS[ch] || ch)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  text = text.replace(/[.,;:!?()\n\r]+(?=\s|$)/g, ` ${BOUNDARY} `);
  text = text.replace(/[^\s]+/g, token => (token === BOUNDARY ? token : mapLeetToken(token)));

  text = text.replace(
    /(?<![\p{L}\p{N}])\p{L}(?:[\s.\-_*·•]+\p{L}(?![\p{L}\p{N}])){2,}/gu,
    run => run.replace(/[\s.\-_*·•]+/g, '')
  );

  text = text.replace(new RegExp(`[^\\p{L}\\p{N}${BOUNDARY}]+`, 'gu'), ' ').replace(/\s+/g, ' ').trim();
  return text;
}

const collapseRuns = (word) => word.replace(/(.)\1{2,}/gu, '$1$1');
const dedupe = (word) => word.replace(/(.)\1+/gu, '$1');

const EXACT_SET = new Set(EXACT_TERMS);
const DEDUPED_EXACT_SET = new Set(EXACT_TERMS.filter(t => t.length >= 4).map(dedupe));

const SACRED_RE = SACRED.join('|');
const INSULT_RE = INSULTS.join('|');
const GLUED_BLASPHEMY_RE = new RegExp(
  `^(?:(?:porc[oa]|maledett[oa])(?:${SACRED_RE})|(?:porc[oa]|maledett[oa])?(?:${SACRED_RE})(?:${INSULT_RE}))$`
);
const SACRED_SET = new Set(SACRED);
const INSULT_SET = new Set(INSULTS);

// -----------------------------------------------------------------------------
// Controlli
// -----------------------------------------------------------------------------
function isBlockedWord(raw) {
  const word = collapseRuns(raw);
  if (!word || SAFE_WORDS.has(word)) return false;
  if (EXACT_SET.has(word)) return true;
  if (word.length >= 4 && DEDUPED_EXACT_SET.has(dedupe(word))) return true;
  if (PREFIX_TERMS.some(prefix => word.startsWith(prefix))) return true;
  if (GLUED_BLASPHEMY_RE.test(word)) return true;
  return false;
}

function expandStarWildcards(text) {
  const extras = [];
  (String(text).toLowerCase().match(/[\p{L}]+\*+[\p{L}]+|[\p{L}]+\*+|\*+[\p{L}]+/gu) || []).forEach(tok => {
    if (!tok.includes('*')) return;
    for (const v of ['a', 'e', 'i', 'o', 'u']) extras.push(tok.replace(/\*+/, v));
  });
  return extras.length ? `${text} ${BOUNDARY} ${extras.join(' ')}` : text;
}

/**
 * Restituisce null se il testo è pulito, altrimenti { kind, match }.
 */
function findProfanity(text) {
  const normalized = normalize(expandStarWildcards(text));
  if (!normalized) return null;

  const tokens = normalized.split(' ').filter(Boolean);

  // 1. Parola per parola
  for (const tok of tokens) {
    if (tok === BOUNDARY) continue;
    if (isBlockedWord(tok)) return { kind: 'word', match: tok };
  }

  // 2. Parole spezzate da uno spazio
  for (let i = 0; i < tokens.length; i++) {
    for (let span = 2; span <= 3 && i + span <= tokens.length; span++) {
      const parts = tokens.slice(i, i + span);
      if (parts.some(p => p === BOUNDARY || p.length > 6)) continue;
      const joined = collapseRuns(parts.join(''));
      if (SAFE_WORDS.has(joined)) continue;
      if (WINDOW_TERMS.has(joined) || GLUED_BLASPHEMY_RE.test(joined)) {
        return { kind: 'split-word', match: joined };
      }
    }
  }

  // 3. Bestemmie
  for (let i = 0; i < tokens.length; i++) {
    const a = collapseRuns(tokens[i]);
    if (a === BOUNDARY) continue;

    const b = tokens[i + 1] ? collapseRuns(tokens[i + 1]) : null;
    if (b && b !== BOUNDARY) {
      if ((SACRED_SET.has(a) && INSULT_SET.has(b)) || (INSULT_SET.has(a) && SACRED_SET.has(b))) {
        return { kind: 'blasphemy', match: `${a} ${b}` };
      }
    }

    const c = tokens[i + 2] ? collapseRuns(tokens[i + 2]) : null;
    if (PREFIX_INSULTS_WITH_DI.has(a) && b === 'di' && c && SACRED_SET.has(c)) {
      return { kind: 'blasphemy', match: `${a} di ${c}` };
    }
  }

  return null;
}

module.exports = { findProfanity, normalize };