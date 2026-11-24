const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// react-country-state-city stores its current data under these minified names.
// The package's own GetCountries/GetState/GetCity helpers expect these exact
// filenames when a custom src is supplied.
const DATA_BASE_URL = (
  process.env.REACT_COUNTRY_STATE_CITY_DATA_URL ||
  'https://raw.githubusercontent.com/venkatmcajj/react-country-state-city/master/data'
).replace(/\/$/, '');

const DATA_FILES = [
  'countriesminified.json',
  'statesminified.json',
  'citiesminified.json'
];

const OUTPUT_DIR = path.resolve(__dirname, '../public/geo-data');
const REFRESH = process.env.REACT_COUNTRY_STATE_CITY_REFRESH === '1';

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function parseJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}


function writeCityIndexes(citiesData) {
  if (!Array.isArray(citiesData)) return;
  const indexDir = path.join(OUTPUT_DIR, 'cities-by-country');
  fs.mkdirSync(indexDir, { recursive: true });

  for (const country of citiesData) {
    if (!country || country.id == null || !Array.isArray(country.states)) continue;

    const outputPath = path.join(indexDir, `${country.id}.json`);
    const payload = {
      id: country.id,
      states: country.states
    };
    const temporaryPath = `${outputPath}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(payload)}\n`, { mode: 0o644 });
    fs.renameSync(temporaryPath, outputPath);
  }
}

function hasUsableCityIndexes() {
  const indexDir = path.join(OUTPUT_DIR, 'cities-by-country');
  try {
    const entries = fs.readdirSync(indexDir);
    return entries.length >= 200;
  } catch {
    return false;
  }
}

function hasUsableLocalData() {
  return DATA_FILES.every((fileName) => {
    const filePath = path.join(OUTPUT_DIR, fileName);
    try {
      const parsed = parseJsonFile(filePath);
      return Array.isArray(parsed) && parsed.length > 0;
    } catch {
      return false;
    }
  });
}

async function fetchJsonBuffer(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Sitov60-geo-data-vendor/2.0'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) {
    throw new Error(`Refusing ${url}: empty response`);
  }

  const text = buffer.toString('utf8');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Refusing ${url}: invalid JSON (${error.message})`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Refusing ${url}: expected a top-level JSON array`);
  }

  return { buffer, parsed };
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  if (!REFRESH && hasUsableLocalData()) {
    if (!hasUsableCityIndexes()) {
      const citiesPath = path.join(OUTPUT_DIR, 'citiesminified.json');
      writeCityIndexes(parseJsonFile(citiesPath));
      console.log('[geo-data] Generated per-country city indexes from the existing local dataset.');
    } else {
      console.log('[geo-data] Complete local react-country-state-city data and city indexes already exist; skipping download.');
    }
    return;
  }

  const downloaded = {};

  for (const fileName of DATA_FILES) {
    const url = `${DATA_BASE_URL}/${fileName}`;
    const { buffer, parsed } = await fetchJsonBuffer(url);
    const temporaryPath = path.join(OUTPUT_DIR, `${fileName}.tmp`);
    const finalPath = path.join(OUTPUT_DIR, fileName);

    fs.writeFileSync(temporaryPath, buffer, { mode: 0o644 });
    fs.renameSync(temporaryPath, finalPath);

    downloaded[fileName] = {
      source: url,
      bytes: buffer.length,
      sha256: sha256(buffer),
      records: parsed.length
    };
  }

  writeCityIndexes(parseJsonFile(path.join(OUTPUT_DIR, 'citiesminified.json')));

  const manifest = {
    provider: 'react-country-state-city',
    packageVersion: '1.1.13',
    sourceRepository: 'https://github.com/venkatmcajj/react-country-state-city',
    dataRepository: 'https://github.com/venkatmcajj/react-country-state-city/tree/master/data',
    generatedAt: new Date().toISOString(),
    files: downloaded
  };

  const manifestPath = path.join(OUTPUT_DIR, 'manifest.json');
  const temporaryManifest = `${manifestPath}.tmp`;
  fs.writeFileSync(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  fs.renameSync(temporaryManifest, manifestPath);

  console.log('[geo-data] Vendored react-country-state-city data:');
  for (const [fileName, metadata] of Object.entries(downloaded)) {
    console.log(`  ${fileName}: ${metadata.records.toLocaleString()} records, ${metadata.bytes.toLocaleString()} bytes, sha256=${metadata.sha256}`);
  }
}

main().catch((error) => {
  console.error(`[geo-data] ${error.message}`);
  process.exit(1);
});
