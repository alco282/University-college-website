import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, MapPin, Sparkles } from 'lucide-react';
import 'react-country-state-city/dist/react-country-state-city.css';

const LOCAL_DATA_SRC = '/geo-data';

// The package data is intentionally loaded directly from the vendored JSON.
// react-country-state-city's public helpers are designed around its hosted
// data source and have changed their local-data behavior across releases.
// Keeping the three small loaders here makes the picker deterministic, fully
// local at runtime, and avoids a hidden network fallback.
const GEO_JSON_CACHE = new Map();

async function loadGeoJson(fileName) {
  if (!GEO_JSON_CACHE.has(fileName)) {
    const promise = fetch(`${LOCAL_DATA_SRC}/${fileName}`, {
      credentials: 'same-origin',
      cache: 'force-cache'
    }).then(response => {
      if (!response.ok) throw new Error(`Unable to load ${fileName}`);
      return response.json();
    });
    GEO_JSON_CACHE.set(fileName, promise);
  }
  return GEO_JSON_CACHE.get(fileName);
}

const loadLocalCountries = () => loadGeoJson('countriesminified.json');

const loadLocalStates = async countryId => {
  const data = await loadGeoJson('statesminified.json');
  const country = Array.isArray(data)
    ? data.find(item => String(item?.id) === String(countryId))
    : null;
  return Array.isArray(country?.states) ? country.states : [];
};

const loadLocalCities = async stateId => {
  const data = await loadGeoJson('citiesminified.json');
  for (const country of Array.isArray(data) ? data : []) {
    const state = Array.isArray(country?.states)
      ? country.states.find(item => String(item?.id) === String(stateId))
      : null;
    if (state) return Array.isArray(state.cities) ? state.cities : [];
  }
  return [];
};

const FALLBACK_CONTINENTS = [
  'Africa',
  'Asia',
  'Europe',
  'North America',
  'South America',
  'Oceania',
  'Antarctica'
];

const LOCAL_COORDS = {
  Italy: {
    coords: [41.8719, 12.5674],
    regions: {
      Piemonte: {
        coords: [45.0703, 7.6869],
        cities: { Torino: [45.0703, 7.6869] }
      },
      Campania: {
        coords: [40.8518, 14.2681],
        cities: {
          Napoli: [40.8518, 14.2681],
          Salerno: [40.6824, 14.7681],
          Benevento: [41.1307, 14.7778]
        }
      }
    }
  },
  France: {
    coords: [46.2276, 2.2137],
    regions: {
      'Île-de-France': {
        coords: [48.8499, 2.637],
        cities: { Paris: [48.8566, 2.3522] }
      }
    }
  },
  Germany: {
    coords: [51.1657, 10.4515],
    regions: {
      Bavaria: {
        coords: [48.7904, 11.4979],
        cities: { Munich: [48.1351, 11.582] }
      }
    }
  },
  'United States': {
    coords: [37.0902, -95.7129],
    regions: {
      California: {
        coords: [36.7783, -119.4179],
        cities: { 'San Francisco': [37.7749, -122.4194] }
      }
    }
  }
};

export function resolveLocationCoords(continent, country, region, city) {
  const countryData = LOCAL_COORDS[country];
  if (!countryData) return null;

  const regionData = countryData.regions?.[region];
  if (regionData) {
    const cityCoords = regionData.cities?.[city];
    if (Array.isArray(cityCoords)) return cityCoords;
    if (Array.isArray(regionData.coords) && !city) return regionData.coords;
  }

  // Only fall back to country center if neither region nor city was provided
  if (!region && !city && Array.isArray(countryData.coords)) {
    return countryData.coords;
  }

  return null;
}

// -----------------------------------------------------------------------------
// Italy: the dataset mixes regions and provinces in one flat "states" list
// (Campania, Benevento, Lazio, Torino ...). Only the 20 regions have cities, so
// for Italy the picker must offer regions only.
//
// A dataset entry is treated as an Italian region when EITHER
//   - its ISO 3166-2:IT code is the 2-digit numeric region code (72 = Campania,
//     62 = Lazio ...; provinces use letter codes such as BN, TO), OR
//   - its normalized name is one of the 20 regions (English dataset spelling or
//     the Italian spelling residents are used to typing).
// -----------------------------------------------------------------------------
const ITALIAN_REGION_KEYS = new Set([
  'abruzzo',
  'aosta valley',
  'apulia',
  'basilicata',
  'calabria',
  'campania',
  'emilia-romagna',
  'friuli-venezia giulia',
  'lazio',
  'liguria',
  'lombardy',
  'marche',
  'molise',
  'piedmont',
  'sardinia',
  'sicily',
  'trentino-south tyrol',
  'tuscany',
  'umbria',
  'veneto'
]);

// Italian (and alternative) spellings -> canonical dataset spelling.
const ITALIAN_REGION_ALIASES = {
  piemonte: 'piedmont',
  lombardia: 'lombardy',
  toscana: 'tuscany',
  puglia: 'apulia',
  sardegna: 'sardinia',
  sicilia: 'sicily',
  "valle d'aosta": 'aosta valley',
  'vallee d\'aoste': 'aosta valley',
  'trentino-alto adige': 'trentino-south tyrol',
  'trentino alto adige': 'trentino-south tyrol',
  'trentino-sudtirol': 'trentino-south tyrol',
  'friuli venezia giulia': 'friuli-venezia giulia'
};

// Stable IDs from the react-country-state-city dataset. These are used only
// as a last-resort client-side fallback when the vendored states file is
// temporarily unavailable; city lookup can still use the same IDs once the
// cities dataset is available.
const ITALIAN_REGION_FALLBACKS = [
  [1679, 'Abruzzo', '65'],
  [1716, 'Aosta Valley', '23'],
  [1688, 'Apulia', '75'],
  [1706, 'Basilicata', '77'],
  [1703, 'Calabria', '78'],
  [1669, 'Campania', '72'],
  [1773, 'Emilia-Romagna', '45'],
  [1756, 'Friuli–Venezia Giulia', '36'],
  [1678, 'Lazio', '62'],
  [1768, 'Liguria', '42'],
  [1705, 'Lombardy', '25'],
  [1670, 'Marche', '57'],
  [1695, 'Molise', '67'],
  [1702, 'Piedmont', '21'],
  [1715, 'Sardinia', '88'],
  [1709, 'Sicily', '82'],
  [1725, 'Trentino-South Tyrol', '32'],
  [1664, 'Tuscany', '52'],
  [1683, 'Umbria', '55'],
  [1753, 'Veneto', '34']
].map(([id, name, state_code]) => ({ id, name, state_code, hasCities: true }));

const ITALIAN_ALIASES_BY_CANONICAL = Object.entries(ITALIAN_REGION_ALIASES).reduce(
  (acc, [alias, canonical]) => {
    (acc[canonical] = acc[canonical] || []).push(alias);
    return acc;
  },
  {}
);

function normalizeForSearch(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // en dash / em dash / minus sign -> plain hyphen ("Friuli–Venezia Giulia")
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    // typographic apostrophes -> plain apostrophe
    .replace(/[\u2018\u2019\u02bc\u00b4`]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/^(provincia di|metropolitan city of|province of)\s+/i, '');
}

function canonicalItalianRegionKey(name) {
  const key = normalizeForSearch(name);
  return ITALIAN_REGION_ALIASES[key] || key;
}

const ITALIAN_REGION_CODES = new Set([
  '21', '23', '25', '32', '34', '36', '42', '45', '52', '55',
  '57', '62', '65', '67', '72', '75', '77', '78', '82', '88'
]);

function isItalianRegion(state) {
  if (!state) return false;

  // The state_code field is not globally unique: other Italian
  // administrative entries can also contain numeric-looking codes.
  // Therefore the region name is the primary discriminator and the
  // official Italian region codes are only a secondary safety net.
  const canonicalName = canonicalItalianRegionKey(state.name);
  if (ITALIAN_REGION_KEYS.has(canonicalName)) return true;

  return ITALIAN_REGION_CODES.has(String(state.state_code ?? '').trim());
}

function isItalyCountry(country) {
  if (!country) return false;
  return (
    String(country.iso2 || '').toUpperCase() === 'IT' ||
    normalizeForSearch(country.name) === 'italy'
  );
}

/**
 * Returns the entries the Region field should offer for a country.
 * Italy -> the 20 regions only. Every other country -> unchanged.
 * If an unexpected dataset shape yields no region at all we fall back to the
 * entries that own cities, and finally to the full list, so the field can
 * never end up empty.
 */
function getSelectableStates(country, states) {
  const list = Array.isArray(states) ? states : [];
  if (!isItalyCountry(country)) return list;

  // Never use `hasCities` as a proxy for "region". The upstream dataset
  // contains provinces that also have cities, so that fallback can re-introduce
  // entries such as Ravenna, Torino, etc. and defeats the Italy-only filter.
  const regions = list.filter(isItalianRegion);
  if (regions.length > 0) return regions;

  // If the upstream/local dataset changes its naming or is temporarily empty,
  // use the fixed 20-region list. These IDs are the IDs used by the same
  // react-country-state-city dataset, so city lookup remains compatible.
  return ITALIAN_REGION_FALLBACKS;
}

function searchScore(item, value) {
  const query = normalizeForSearch(value);
  if (!query) return 1000;

  const terms = Array.isArray(item?.terms) && item.terms.length
    ? item.terms
    : [item?.name ?? item?.label ?? ''];

  let best = Number.POSITIVE_INFINITY;
  for (const rawTerm of terms) {
    const term = normalizeForSearch(rawTerm);
    if (!term) continue;

    if (term === query) best = Math.min(best, 0);
    else if (term.startsWith(query)) best = Math.min(best, 10 + (term.length - query.length) / 1000);
    else if (term.split(/\s+/).some(word => word.startsWith(query))) best = Math.min(best, 20);
    else if (term.includes(query)) best = Math.min(best, 30);
  }

  return best;
}

function findBestMatch(items, value) {
  if (!Array.isArray(items) || !value) return null;
  const ranked = items
    .map((item, index) => ({ item, index, score: searchScore(item, value) }))
    .filter(entry => Number.isFinite(entry.score))
    .sort((a, b) => a.score - b.score || a.index - b.index);
  return ranked[0]?.item || null;
}


function countrySearchTerms(country) {
  return [country?.name, country?.native, country?.iso2, country?.iso3].filter(Boolean);
}

function findCountryMatch(countries, value) {
  if (!Array.isArray(countries) || !value) return null;
  const query = normalizeForSearch(value);
  const ranked = countries
    .map((country, index) => ({
      country,
      index,
      score: searchScore({ terms: countrySearchTerms(country) }, query)
    }))
    .filter(entry => Number.isFinite(entry.score))
    .sort((a, b) => a.score - b.score || a.index - b.index);
  return ranked[0]?.country || null;
}

function findExactCountryMatch(countries, value) {
  if (!Array.isArray(countries) || !value) return null;
  const query = normalizeForSearch(value);
  return countries.find(country =>
    countrySearchTerms(country).some(term => normalizeForSearch(term) === query)
  ) || null;
}

function matchCountry(countries, detectedCountry, countryCode) {
  if (!Array.isArray(countries) || countries.length === 0) return null;

  if (countryCode) {
    const codeMatch = countries.find(
      c => String(c?.iso2 || '').toLowerCase() === String(countryCode).toLowerCase()
    );
    if (codeMatch) return codeMatch;
  }

  return findBestMatch(countries, detectedCountry);
}

function getCountryRegion(country) {
  return country?.region || country?.subregion || '';
}

// Like findBestMatch, but for the Region field: Italian spellings such as
// "Piemonte" or "Lombardia" resolve to the dataset's "Piedmont" / "Lombardy".
function findStateMatch(country, states, value) {
  if (!Array.isArray(states) || !value) return null;

  if (isItalyCountry(country)) {
    const key = canonicalItalianRegionKey(value);
    const aliasHit = states.find(item => canonicalItalianRegionKey(item?.name) === key);
    if (aliasHit) return aliasHit;
  }

  return findBestMatch(states, value);
}

/**
 * Text field with a suggestion list that opens on click/focus (and filters as
 * you type). Replaces the native <datalist>, whose popup is not shown on
 * focus by many browsers (notably on mobile) and competes with the browser's
 * address autofill.
 */
function SuggestField({
  id,
  value,
  onChange,
  onSelect,
  onCommit,
  options,
  disabled,
  placeholder,
  className,
  emptyText,
  maxItems = 400
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listRef = useRef(null);

  const query = normalizeForSearch(value);

  const visible = useMemo(() => {
    if (!query) return options;

    // Rank prefix/exact matches ahead of substring matches. This prevents a
    // query such as "it" from being dominated by Eritrea, Mauritania,
    // Mauritius, etc. and makes the intended result (Italy) appear first.
    return options
      .map((option, index) => ({ option, index, score: searchScore(option, query) }))
      .filter(entry => Number.isFinite(entry.score))
      .sort((a, b) => a.score - b.score || a.index - b.index)
      .map(entry => entry.option);
  }, [options, query]);

  const shown = visible.slice(0, maxItems);
  const isOpen = open && !disabled;

  useEffect(() => {
    setActiveIndex(-1);
  }, [query, open]);

  useEffect(() => {
    if (!isOpen || activeIndex < 0) return;
    const node = listRef.current?.querySelector('[data-active="true"]');
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, isOpen]);

  const choose = option => {
    onSelect(option);
    setOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = event => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!isOpen) {
        setOpen(true);
        return;
      }
      setActiveIndex(index => Math.min(index + 1, shown.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(index => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      // Never let Enter submit the surrounding form while picking an option.
      if (isOpen && activeIndex >= 0 && shown[activeIndex]) {
        event.preventDefault();
        choose(shown[activeIndex]);
      }
    } else if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <input
        id={id}
        name={`${id}-search`}
        type="text"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={`${id}-listbox`}
        aria-autocomplete="list"
        aria-activedescendant={isOpen && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
        value={value || ''}
        onChange={event => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          if (onCommit) onCommit();
        }}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder={placeholder}
        className={`${className} pr-7`}
      />
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400"
      />

      {isOpen && (
        <ul
          id={`${id}-listbox`}
          role="listbox"
          ref={listRef}
          // Keep focus in the input while scrolling / clicking inside the list.
          onMouseDown={event => event.preventDefault()}
          className="absolute z-40 left-0 right-0 mt-1 max-h-56 overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-lg py-1 text-xs"
        >
          {shown.map((option, index) => (
            <li
              key={option.key}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              data-active={index === activeIndex ? 'true' : undefined}
              onPointerDown={event => {
                event.preventDefault();
                choose(option);
              }}
              onMouseEnter={() => setActiveIndex(index)}
              className={`px-3 py-1.5 cursor-pointer ${
                index === activeIndex ? 'bg-red-50 text-[#B31217]' : 'text-gray-800 hover:bg-gray-50'
              } ${option.label === value ? 'font-bold' : ''}`}
            >
              {option.prefix || ''}{option.label}
            </li>
          ))}

          {shown.length === 0 && emptyText && (
            <li role="presentation" className="px-3 py-2 text-gray-500">{emptyText}</li>
          )}

          {visible.length > shown.length && (
            <li role="presentation" className="px-3 py-2 text-gray-400 border-t border-gray-100">
              Showing the first {shown.length} of {visible.length}. Keep typing to narrow the list.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export function GeoLocationPicker({
  continent,
  setContinent,
  country,
  setCountry,
  region,
  setRegion,
  city,
  setCity,
  lat,
  setLat,
  lng,
  setLng,
  showToast,
  onCountryValidityChange
}) {
  const [countries, setCountries] = useState([]);
  const [availableStates, setAvailableStates] = useState([]);
  const [availableCities, setAvailableCities] = useState([]);

  const [selectedCountry, setSelectedCountry] = useState(null);
  const [selectedState, setSelectedState] = useState(null);
  const [selectedCity, setSelectedCity] = useState(null);

  const [isLocating, setIsLocating] = useState(false);
  const [isLoadingStates, setIsLoadingStates] = useState(false);
  const [isLoadingCities, setIsLoadingCities] = useState(false);
  const [isResolvingCoords, setIsResolvingCoords] = useState(false);

  const abortControllerRef = useRef(null);
  const geocodeTimeoutRef = useRef(null);
  const stateRequestRef = useRef(0);
  const cityRequestRef = useRef(0);

  // All geographic data is served from the application's own /geo-data
  // directory. There is deliberately no remote fallback.
  const loadCountries = () => loadLocalCountries();

  const loadStates = countryId => loadLocalStates(countryId);

  const loadCities = (countryId, stateId) => loadLocalCities(stateId);

  useEffect(() => {
    let cancelled = false;

    loadCountries()
      .then(result => {
        if (!cancelled) {
          setCountries(Array.isArray(result) ? result : []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCountries([]);
          onCountryValidityChange?.(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [onCountryValidityChange]);

  const continents = useMemo(() => {
    const values = countries.map(getCountryRegion).filter(Boolean);
    return Array.from(new Set([...values, ...FALLBACK_CONTINENTS])).sort((a, b) => a.localeCompare(b));
  }, [countries]);

  const filteredCountries = useMemo(() => {
    if (!continent) return countries;
    return countries.filter(item => getCountryRegion(item) === continent);
  }, [countries, continent]);

  // Synchronize a valid externally-prefilled country, but NEVER invalidate the
  // current selection just because the user is typing a partial search string.
  // Draft text is handled by the input handlers; committed selection is handled
  // only by select/blur/GPS. This prevents transient values from tearing down the
  // country -> region -> city dependency chain.
  useEffect(() => {
    if (!country || !countries.length) return;

    const match = findExactCountryMatch(countries, country);
    if (!match) return;

    const sameCountry =
      selectedCountry && String(selectedCountry.id) === String(match.id);

    if (!sameCountry) {
      setSelectedCountry(match);
      onCountryValidityChange?.(true);
    }

    const itemRegion = getCountryRegion(match);
    if (itemRegion && itemRegion !== continent) {
      setContinent(itemRegion);
    }
  }, [countries, country, continent, selectedCountry, setContinent, onCountryValidityChange]);

  useEffect(() => {
    let cancelled = false;
    const requestId = ++stateRequestRef.current;

    setAvailableStates([]);
    setSelectedState(null);
    setAvailableCities([]);
    setSelectedCity(null);
    setIsLoadingStates(false);

    if (!selectedCountry?.id) return undefined;

    setIsLoadingStates(true);

    loadStates(selectedCountry.id)
      .then(result => {
        if (cancelled || requestId !== stateRequestRef.current) return;

        // Italy: regions only (see getSelectableStates).
        setAvailableStates(getSelectableStates(selectedCountry, result));
      })
      .catch(() => {
        if (!cancelled && requestId === stateRequestRef.current) {
          // The local dataset fetch failed (e.g. cold start, transient
          // network blip). Still run it through getSelectableStates: for
          // Italy this guarantees the fixed 20-region fallback list
          // instead of leaving the Region field completely empty, which
          // is otherwise indistinguishable from "no regions exist".
          setAvailableStates(getSelectableStates(selectedCountry, []));
        }
      })
      .finally(() => {
        if (!cancelled && requestId === stateRequestRef.current) {
          setIsLoadingStates(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedCountry]);

  // Region text is a draft. Do not fuzzy-select a region while the user is
  // still typing; only a list selection or an exact blur commit may load cities.

  useEffect(() => {
    let cancelled = false;
    const requestId = ++cityRequestRef.current;

    setAvailableCities([]);
    setSelectedCity(null);
    setIsLoadingCities(false);

    if (!selectedCountry?.id || !selectedState?.id) return undefined;

    setIsLoadingCities(true);
    loadCities(selectedCountry.id, selectedState.id)
      .then(result => {
        if (!cancelled && requestId === cityRequestRef.current) {
          setAvailableCities(Array.isArray(result) ? result : []);
        }
      })
      .catch(() => {
        if (!cancelled && requestId === cityRequestRef.current) {
          setAvailableCities([]);
        }
      })
      .finally(() => {
        if (!cancelled && requestId === cityRequestRef.current) {
          setIsLoadingCities(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedCountry, selectedState]);

  // City text is also a draft. Avoid fuzzy-matching it on every keystroke,
  // otherwise typing "San" could immediately select an unrelated city and move
  // the coordinates underneath the user.

  const handleContinentChange = event => {
    const value = event.target.value;
    setContinent(value);
    setCountry('');
    setRegion('');
    setCity('');
    setSelectedCountry(null);
    setSelectedState(null);
    setSelectedCity(null);
    setAvailableStates([]);
    setAvailableCities([]);
    setLat('');
    setLng('');
    onCountryValidityChange?.(false);
  };

  const clearCountryDependents = () => {
    setRegion('');
    setCity('');
    setSelectedState(null);
    setSelectedCity(null);
    setAvailableStates([]);
    setAvailableCities([]);
    setLat('');
    setLng('');
  };

  // Typing only changes the draft text. It intentionally does not try to
  // resolve a country, region or city. That work happens on select/commit.
  const handleCountryInput = value => {
    setCountry(value);
    setSelectedCountry(null);
    clearCountryDependents();
    onCountryValidityChange?.(false);
  };

  const handleCountrySelect = option => {
    const match = filteredCountries.find(
      item => String(item?.id) === String(option?.key)
    ) || findExactCountryMatch(filteredCountries, option?.label);

    if (!match) return;

    const sameCountry =
      selectedCountry && String(selectedCountry.id) === String(match.id);

    if (!sameCountry) clearCountryDependents();

    setSelectedCountry(match);
    setCountry(match.name);
    setContinent(getCountryRegion(match));
    onCountryValidityChange?.(true);
  };

  const handleCountryBlur = () => {
    if (!country) {
      setSelectedCountry(null);
      onCountryValidityChange?.(false);
      clearCountryDependents();
      return;
    }

    // Country selection is strict: never silently convert arbitrary text into a
    // fuzzy country just because the field lost focus.
    const match = findExactCountryMatch(filteredCountries, country);
    if (!match) {
      setSelectedCountry(null);
      onCountryValidityChange?.(false);
      return;
    }

    handleCountrySelect({ key: match.id, label: match.name });
  };

  const handleStateInput = value => {
    setRegion(value);
    setSelectedState(null);
    setCity('');
    setSelectedCity(null);
    setAvailableCities([]);
    setLat('');
    setLng('');
  };

  const handleStateSelect = option => {
    const match = availableStates.find(
      item => String(item?.id) === String(option?.key)
    ) || findStateMatch(selectedCountry, availableStates, option?.label);

    if (!match) return;

    const sameState =
      selectedState && String(selectedState.id) === String(match.id);

    setRegion(match.name);
    setSelectedState(match);

    if (sameState) return;

    setCity('');
    setSelectedCity(null);
    setAvailableCities([]);
    setLat('');
    setLng('');
  };

  const handleStateBlur = () => {
    if (!region) {
      setSelectedState(null);
      setCity('');
      setSelectedCity(null);
      setAvailableCities([]);
      return;
    }

    // Exact/alias match only. Partial text stays a draft and does not trigger
    // a city lookup. This is especially important for Italy, where aliases like
    // "Piemonte" intentionally map to the canonical "Piedmont" dataset entry.
    const match = availableStates.find(
      item => normalizeForSearch(item?.name) === normalizeForSearch(region)
    ) || (
      isItalyCountry(selectedCountry)
        ? availableStates.find(
            item => canonicalItalianRegionKey(item?.name) === canonicalItalianRegionKey(region)
          )
        : null
    );

    if (match) {
      handleStateSelect({ key: match.id, label: match.name });
    }
  };

  const applyCitySelection = match => {
    if (!match) return;

    setSelectedCity(match);
    setCity(match.name);

    const cityLat = Number(match.latitude);
    const cityLng = Number(match.longitude);
    if (Number.isFinite(cityLat) && Number.isFinite(cityLng)) {
      setLat(cityLat.toFixed(4));
      setLng(cityLng.toFixed(4));
    }
  };

  const handleCityInput = value => {
    setCity(value);
    setSelectedCity(null);
  };

  const handleCitySelect = option => {
    const match = availableCities.find(
      item => String(item?.id) === String(option?.key)
    ) || findBestMatch(availableCities, option?.label);

    applyCitySelection(match);
  };

  const handleCityBlur = () => {
    if (!city) {
      setSelectedCity(null);
      return;
    }

    // Accept only an exact city-name match on blur. Users can still leave free
    // text here; it will be used by the debounced geocoder without contaminating
    // the selected city state.
    const query = normalizeForSearch(city);
    const match = availableCities.find(item => normalizeForSearch(item?.name) === query);

    if (match) applyCitySelection(match);
  };

  const handleGeolocateMe = () => {
    if (!navigator.geolocation) {
      showToast?.('Geolocation is not supported by your browser.', 'error');
      return;
    }

    setIsLocating(true);

    navigator.geolocation.getCurrentPosition(
      async position => {
        const userLat = position.coords.latitude;
        const userLng = position.coords.longitude;

        setLat(userLat.toFixed(4));
        setLng(userLng.toFixed(4));

        try {
          // Query Nominatim in English to align with dataset names
          const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(userLat)}&lon=${encodeURIComponent(userLng)}&format=jsonv2&addressdetails=1&accept-language=en`,
            { headers: { 'Accept-Language': 'en' } }
          );

          if (!response.ok) throw new Error('Reverse geocoding failed.');

          const data = await response.json();
          const address = data?.address || {};

          const detectedCity =
            address.city ||
            address.town ||
            address.village ||
            address.municipality ||
            '';

          // For Italy and other countries, handle province vs state/region hierarchy
          const detectedRegion =
            address.county ||
            address.province ||
            address.state ||
            address.region ||
            '';

          const detectedCountry = address.country || '';
          const detectedCountryCode = address.country_code || '';

          const countryMatch = matchCountry(countries, detectedCountry, detectedCountryCode);

          if (!countryMatch) {
            setSelectedCountry(null);
            setCountry(detectedCountry);
            setContinent('');
            setRegion(detectedRegion);
            setCity(detectedCity);
            onCountryValidityChange?.(false);
            showToast?.('GPS detected a country not found in the dataset.', 'warning');
            return;
          }

          setSelectedCountry(countryMatch);
          setCountry(countryMatch.name);
          setContinent(getCountryRegion(countryMatch));
          onCountryValidityChange?.(true);

          const states = await loadStates(countryMatch.id);
          const stateList = getSelectableStates(countryMatch, states);
          const italy = isItalyCountry(countryMatch);

          // Italy: the list only holds regions, and Nominatim's `county` is a
          // province, so match on the region (`state`) first. Everywhere else
          // keep the original order: county/province first, then state.
          const stateMatch = italy
            ? findStateMatch(countryMatch, stateList, address.state) ||
              findStateMatch(countryMatch, stateList, address.region) ||
              findStateMatch(countryMatch, stateList, detectedRegion)
            : findBestMatch(stateList, detectedRegion) ||
              findBestMatch(stateList, address.state);

          if (!stateMatch) {
            setSelectedState(null);
            setRegion(italy ? (address.state || '') : detectedRegion);
            setCity(detectedCity);
            setSelectedCity(null);
            return;
          }

          setSelectedState(stateMatch);
          setRegion(stateMatch.name);

          const cities = await loadCities(countryMatch.id, stateMatch.id);
          const cityMatch = findBestMatch(Array.isArray(cities) ? cities : [], detectedCity);

          if (cityMatch) {
            setSelectedCity(cityMatch);
            setCity(cityMatch.name);
          } else {
            setSelectedCity(null);
            setCity(detectedCity);
          }

          showToast?.('Location successfully detected and matched.', 'success');
        } catch {
          showToast?.('GPS coordinates detected. Place names could not be resolved.', 'info');
        } finally {
          setIsLocating(false);
        }
      },
      error => {
        setIsLocating(false);
        showToast?.('Unable to read your location. Check the browser location permission.', 'error');
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  };

  // Automated geocode resolution when inputs change
  useEffect(() => {
    if (!country && !region && !city) {
      setLat('');
      setLng('');
      return undefined;
    }

    if (selectedCity?.latitude && selectedCity?.longitude) {
      const cityLat = Number(selectedCity.latitude);
      const cityLng = Number(selectedCity.longitude);
      if (Number.isFinite(cityLat) && Number.isFinite(cityLng)) {
        setLat(cityLat.toFixed(4));
        setLng(cityLng.toFixed(4));
        return undefined;
      }
    }

    const localCoords = resolveLocationCoords(continent, country, region, city);
    if (Array.isArray(localCoords)) {
      setLat(Number(localCoords[0]).toFixed(4));
      setLng(Number(localCoords[1]).toFixed(4));
      return undefined;
    }

    // Do not geocode while the country field is only a draft. Coordinates are
    // derived only after a recognized country has been committed.
    if (!country || !selectedCountry?.id) return undefined;

    if (geocodeTimeoutRef.current) clearTimeout(geocodeTimeoutRef.current);
    if (abortControllerRef.current) abortControllerRef.current.abort();

    geocodeTimeoutRef.current = setTimeout(async () => {
      const queryParts = [city, region, country].filter(Boolean);
      if (!queryParts.length) return;

      abortControllerRef.current = new AbortController();
      setIsResolvingCoords(true);

      try {
        const query = encodeURIComponent(queryParts.join(', '));
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${query}&format=jsonv2&limit=1&addressdetails=1`,
          {
            signal: abortControllerRef.current.signal,
            headers: { 'Accept-Language': 'en,it' }
          }
        );

        if (!response.ok) throw new Error('Geocoding request failed.');

        const data = await response.json();
        const item = Array.isArray(data) ? data[0] : null;
        const parsedLat = Number(item?.lat);
        const parsedLng = Number(item?.lon);

        if (Number.isFinite(parsedLat) && Number.isFinite(parsedLng)) {
          setLat(parsedLat.toFixed(4));
          setLng(parsedLng.toFixed(4));
        }
      } catch (error) {
        // Retain existing coordinates on abort
      } finally {
        setIsResolvingCoords(false);
      }
    }, 700);

    return () => {
      if (geocodeTimeoutRef.current) clearTimeout(geocodeTimeoutRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, [continent, country, region, city, selectedCountry, selectedCity, setLat, setLng]);

  const italySelected = isItalyCountry(selectedCountry);

  const countryOptions = useMemo(
    () =>
      filteredCountries
        .slice()
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
        .map(item => ({
          key: item.id,
          label: item.name,
          terms: countrySearchTerms(item),
          prefix: item.emoji ? `${item.emoji} ` : ''
        })),
    [filteredCountries]
  );

  const stateOptions = useMemo(
    () => {
      // Keep the UI guard separate from data loading: even if a future data
      // source accidentally returns Italian provinces, the Region field can
      // never expose them.
      const statesForPicker = italySelected
        ? availableStates.filter(isItalianRegion)
        : availableStates;

      return statesForPicker
        .slice()
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
        .map(item => ({
          key: item.id,
          label: item.name,
          // Italian residents can find "Piemonte" / "Lombardia" by typing them.
          terms: [
            item.name,
            ...(ITALIAN_ALIASES_BY_CANONICAL[canonicalItalianRegionKey(item.name)] || [])
          ]
        }));
    },
    [availableStates, italySelected]
  );

  const cityOptions = useMemo(
    () =>
      availableCities
        .slice()
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
        .map(item => ({
          key: item.id,
          label: item.name,
          terms: [
            item.name,
            ...(normalizeForSearch(item.name) === 'turin' ? ['torino'] : []),
            ...(normalizeForSearch(item.name) === 'torino' ? ['turin'] : [])
          ]
        })),
    [availableCities]
  );

  return (
    <div className="space-y-3 bg-[#FAF8F5] p-4 rounded-2xl border border-gray-200 shadow-inner">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-200 pb-2.5">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-[#B31217]" />
          <span className="text-xs font-bold uppercase tracking-wider text-gray-800">
            Geographic Origin & Coordinates
          </span>
        </div>

        <button
          type="button"
          onClick={handleGeolocateMe}
          disabled={isLocating}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#B31217] hover:bg-[#8A0E12] disabled:bg-gray-400 text-white rounded-xl text-xs font-bold shadow-sm transition-all shrink-0"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>{isLocating ? 'Acquiring...' : 'Detect location (GPS)'}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        <div>
          <label className="text-[10px] text-gray-500 font-bold block mb-1">Continent <span className="text-gray-900">*</span></label>
          <select
            value={continent || ''}
            onChange={handleContinentChange}
            className="w-full p-2 border border-gray-300 rounded-xl text-xs bg-white text-gray-800 font-medium"
          >
            <option value="">Select continent...</option>
            {continents.map(item => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>

        <div className="min-w-0">
          <label className="text-[10px] text-gray-500 font-bold block mb-1">Country / Nation *</label>
          <SuggestField
            id="registration-country"
            value={country || ''}
            onChange={handleCountryInput}
            onSelect={handleCountrySelect}
            onCommit={handleCountryBlur}
            options={countryOptions}
            disabled={!continent}
            placeholder={continent ? 'Type or select country...' : 'Select continent first...'}
            emptyText="No matching country in this continent."
            className="w-full p-2 border border-gray-300 rounded-xl text-xs bg-white text-gray-800 font-medium disabled:bg-gray-100 disabled:text-gray-400"
          />
        </div>

        <div className="min-w-0">
          <label className="text-[10px] text-gray-500 font-bold block mb-1">
            {italySelected ? 'Region' : 'Region / Province'} <span className="text-gray-900">*</span>
          </label>
          <SuggestField
            id="registration-state"
            value={region || ''}
            onChange={handleStateInput}
            onSelect={handleStateSelect}
            onCommit={handleStateBlur}
            options={stateOptions}
            disabled={!selectedCountry?.id || isLoadingStates}
            placeholder={
              isLoadingStates
                ? 'Loading regions...'
                : selectedCountry?.id
                  ? (italySelected ? 'Select region...' : 'Type or select region/province...')
                  : 'Select country first...'
            }
            emptyText="No matching region. Your text will be used as typed."
            className="w-full p-2 border border-gray-300 rounded-xl text-xs bg-white text-gray-800 font-medium disabled:bg-gray-100 disabled:text-gray-400"
          />
        </div>

        <div className="min-w-0">
          <label className="text-[10px] text-gray-500 font-bold block mb-1">City *</label>
          <SuggestField
            id="registration-city"
            value={city || ''}
            onChange={handleCityInput}
            onSelect={handleCitySelect}
            onCommit={handleCityBlur}
            options={cityOptions}
            disabled={!country}
            placeholder={isLoadingCities ? 'Loading cities...' : 'Type or select city...'}
            emptyText="No matching city. Your text will be used as typed."
            className="w-full p-2 border border-gray-300 rounded-xl text-xs bg-white text-gray-800 font-medium disabled:bg-gray-100 disabled:text-gray-400"
          />
        </div>
      </div>

      {country && !selectedCountry && (
        <p className="text-[11px] text-amber-700">
          Select a recognized country from the list to enable location lookup.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className="text-[10px] text-gray-500 font-bold block mb-1">Latitude</label>
          <input
            type="text"
            value={lat || ''}
            readOnly
            placeholder="Auto-detected"
            className="w-full p-2 border border-gray-200 rounded-xl text-xs bg-gray-50 text-gray-600"
          />
        </div>

        <div>
          <label className="text-[10px] text-gray-500 font-bold block mb-1">Longitude</label>
          <input
            type="text"
            value={lng || ''}
            readOnly
            placeholder="Auto-detected"
            className="w-full p-2 border border-gray-200 rounded-xl text-xs bg-gray-50 text-gray-600"
          />
        </div>
      </div>

      {isResolvingCoords && (
        <p className="text-[11px] text-gray-500 animate-pulse">
          Resolving coordinates for {city || region}...
        </p>
      )}
    </div>
  );
}