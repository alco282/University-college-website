const fs = require('fs');
const path = require('path');
const { domainToASCII } = require('url');
const BLOCKLIST_PATH = path.join(__dirname, '..', 'data', 'disposable-email-domains.txt');
let cachedDomains = null;
function loadDomains() {
  if (cachedDomains) return cachedDomains;
  try {
    cachedDomains = new Set(fs.readFileSync(BLOCKLIST_PATH, 'utf8').split(/\r?\n/).map(v => v.trim().toLowerCase()).filter(v => v && !v.startsWith('#')));
  } catch { cachedDomains = new Set(); }
  return cachedDomains;
}
function isDisposableEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at < 1) return false;
  let domain = value.slice(at + 1);
  try { domain = domainToASCII(domain) || domain; } catch {}
  const domains = loadDomains();
  const parts = domain.split('.');
  for (let i = 0; i < parts.length - 1; i += 1) if (domains.has(parts.slice(i).join('.'))) return true;
  return false;
}
module.exports = { isDisposableEmail };
