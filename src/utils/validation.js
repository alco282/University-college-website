const ALLOWED_FLOORS = Object.freeze([
  '0 floor',
  '1st floor',
  '2nd floor',
  '3rd floor',
  '4th floor',
  '5th floor'
]);

const ALLOWED_SECTIONS = Object.freeze([
  'Residence_name_1','Residence_name_2','Residence_name_3'
]);

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function validateBirthInput(value, { required = false } = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) return required
    ? { valid: false, error: 'Date of birth is required.', birthDate: null, birthYear: null }
    : { valid: true, error: null, birthDate: null, birthYear: null };

  if (!/^[0-9./-]+$/.test(raw)) {
    return { valid: false, error: 'Date of birth may contain only digits and /, -, or . separators.', birthDate: null, birthYear: null };
  }

  const currentYear = new Date().getUTCFullYear();
  let match = raw.match(/^(\d{2})[./-](\d{2})[./-](\d{4})$/);
  if (!match) match = raw.match(/^(\d{2})[./-](\d{2})[./-](\d{2})$/);

  if (!match) {
    if (/^\d{4}$/.test(raw)) {
      const year = Number(raw);
      return year >= 1900 && year <= currentYear
        ? { valid: true, error: null, birthDate: null, birthYear: year }
        : { valid: false, error: `Birth year must be between 1900 and ${currentYear}.`, birthDate: null, birthYear: null };
    }
    return { valid: false, error: 'Use DD/MM/YYYY, DD/MM/YY, or YYYY.', birthDate: null, birthYear: null };
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = Number(match[3]);
  if (match[3].length === 2) year = year <= (currentYear % 100) ? 2000 + year : 1900 + year;

  const date = new Date(Date.UTC(year, month - 1, day));
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;

  if (!real || year < 1900 || year > currentYear || date > todayUtc) {
    return {
      valid: false,
      error: date > todayUtc ? 'Date of birth cannot be in the future.' : 'Enter a real calendar date that is not in the future.',
      birthDate: null,
      birthYear: null
    };
  }

  return {
    valid: true,
    error: null,
    birthDate: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    birthYear: year
  };
}

function monthToOrdinal(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  return year * 12 + monthNumber;
}

function validateResidenceHistory(history, primaryPeriod = null) {
  if (history == null) return { valid: true, value: [] };
  if (!Array.isArray(history) || history.length > 20) {
    return { valid: false, error: 'Residence history must contain at most 20 entries.' };
  }

  const out = [];

  for (let i = 0; i < history.length; i += 1) {
    const e = history[i] || {};
    const startDate = String(e.startDate ?? '').trim();
    const endDate = e.endDate == null || String(e.endDate).trim() === '' ? null : String(e.endDate).trim();
    const section = String(e.section ?? '').trim();
    const floor = String(e.floor ?? '').trim();
    const room = String(e.room ?? '').trim();

    if (!MONTH_RE.test(startDate)) {
      return { valid: false, error: `Historical residence #${i + 1}: start month/year must use MM/YYYY.` };
    }
    if (endDate && !MONTH_RE.test(endDate)) {
      return { valid: false, error: `Historical residence #${i + 1}: end month/year must use MM/YYYY.` };
    }

    const startOrdinal = monthToOrdinal(startDate);
    const endOrdinal = endDate ? monthToOrdinal(endDate) : null;

    if (endOrdinal !== null && endOrdinal < startOrdinal) {
      return { valid: false, error: `Historical residence #${i + 1}: end month cannot be earlier than start month.` };
    }
    if (!ALLOWED_SECTIONS.includes(section)) {
      return { valid: false, error: `Historical residence #${i + 1}: invalid residence section.` };
    }
    if (!ALLOWED_FLOORS.includes(floor)) {
      return { valid: false, error: `Historical residence #${i + 1}: invalid floor.` };
    }
    if (!/^\d+$/.test(room) || room.length > 30) {
      return { valid: false, error: `Historical residence #${i + 1}: room must contain digits only.` };
    }

    out.push({
      startDate,
      endDate,
      section,
      floor,
      room
    });
  }

  if (out.filter(e => e.endDate === null).length > 1) {
    return { valid: false, error: 'Only one current/open-ended historical residence is allowed.' };
  }

  if (primaryPeriod?.startDate && primaryPeriod?.section) {
    const primaryStart = monthToOrdinal(primaryPeriod.startDate);
    const primaryEnd = primaryPeriod.endDate ? monthToOrdinal(primaryPeriod.endDate) : Number.POSITIVE_INFINITY;
    for (let i = 0; i < out.length; i += 1) {
      const h = out[i];
      if (h.section === primaryPeriod.section) continue;
      const hStart = monthToOrdinal(h.startDate);
      const hEnd = h.endDate ? monthToOrdinal(h.endDate) : Number.POSITIVE_INFINITY;
      if (primaryStart <= hEnd && hStart <= primaryEnd) {
        return {
          valid: false,
          error: `Historical residence #${i + 1} overlaps the primary residence (${primaryPeriod.section}) during an incompatible period.`
        };
      }
    }
  }

  for (let i = 0; i < out.length; i += 1) {
    const a = out[i];
    const aStart = monthToOrdinal(a.startDate);
    const aEnd = a.endDate ? monthToOrdinal(a.endDate) : Number.POSITIVE_INFINITY;

    for (let j = i + 1; j < out.length; j += 1) {
      const b = out[j];
      if (a.section === b.section) continue;

      const bStart = monthToOrdinal(b.startDate);
      const bEnd = b.endDate ? monthToOrdinal(b.endDate) : Number.POSITIVE_INFINITY;

      if (aStart <= bEnd && bStart <= aEnd) {
        return {
          valid: false,
          error: `Historical residences #${i + 1} and #${j + 1} overlap while using different sections (${a.section} and ${b.section}).`
        };
      }
    }
  }

  return { valid: true, value: out };
}

function capitalizeName(value, { preserveParticles = false } = {}) {
  const str = String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('it-IT');

  if (!str) return '';

  let result = str.replace(/(^|[\s'’\-])(\p{L})/gu, (m, sep, ch) => 
    sep + ch.toLocaleUpperCase('it-IT')
  );

  result = result.replace(/\b(Mc|Mac)(\p{L})/gu, (m, prefix, nextChar) => 
    prefix + nextChar.toLocaleUpperCase('it-IT')
  );

  if (preserveParticles) {
    const lowercaseParticles = ['de', "de'", 'del', 'della', 'delle', 'dei', 'degli', 'da', 'di', 'van', 'von', 'der', 'y'];
    const pattern = new RegExp(`\\b(${lowercaseParticles.join('|')})\\b`, 'giu');
    
    result = result.replace(pattern, (match, particle, offset) => {
      return offset === 0 ? match : particle.toLocaleLowerCase('it-IT');
    });
  }

  return result;
}

module.exports = {
  ALLOWED_FLOORS,
  ALLOWED_SECTIONS,
  validateBirthInput,
  validateResidenceHistory,
  capitalizeName
};
