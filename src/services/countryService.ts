/**
 * Reconciling country across the two vocabularies that have to meet.
 *
 * A rate card carries whatever was typed or tagged on upload — "USA", "US",
 * "United States". Domo's `rsr_country` carries "UNITED STATES OF AMERICA".
 * Neither is wrong, and neither joins to the other, so a card-to-actuals
 * comparison scoped by country silently matches nothing until both sides are
 * reduced to one key.
 *
 * Unlike client names this is a closed vocabulary, so it needs a lookup table
 * rather than scoring and human review. What it shares with client matching is
 * the rule that an unrecognised value is reported, never quietly dropped: a
 * country that fails to normalise would otherwise remove its rows from every
 * scoped report without appearing anywhere as a problem.
 *
 * Canonical form is ISO 3166-1 alpha-2 — short, stable, and unambiguous in a
 * way that display names are not.
 */

interface CountryDefinition {
  /** ISO 3166-1 alpha-2. */
  code: string;
  /** How the country is shown in the UI. */
  name: string;
  /**
   * Every other spelling seen or plausible, normalized the same way input is.
   * The code and the name are registered automatically and need not repeat.
   */
  aliases: string[];
}

/**
 * The vocabulary this program actually spans, plus the countries a global MSP
 * plausibly reaches. Not exhaustive on purpose — `collectUnmappedCountries`
 * reports what is missing from real data, which is a better guide than a
 * complete ISO list nobody has checked against the source.
 */
const COUNTRIES: CountryDefinition[] = [
  // --- confirmed present in this program's data ---
  { code: 'US', name: 'United States', aliases: ['UNITED STATES OF AMERICA', 'USA', 'US', 'AMERICA', 'U S A', 'U S'] },
  { code: 'CA', name: 'Canada', aliases: ['CAN'] },
  { code: 'PR', name: 'Puerto Rico', aliases: [] },
  { code: 'GB', name: 'United Kingdom', aliases: ['UK', 'GREAT BRITAIN', 'ENGLAND', 'SCOTLAND', 'WALES', 'NORTHERN IRELAND', 'GBR'] },

  // --- Americas ---
  { code: 'MX', name: 'Mexico', aliases: ['MEX'] },
  { code: 'BR', name: 'Brazil', aliases: ['BRASIL', 'BRA'] },
  { code: 'AR', name: 'Argentina', aliases: ['ARG'] },
  { code: 'CL', name: 'Chile', aliases: ['CHL'] },
  { code: 'CO', name: 'Colombia', aliases: ['COL'] },
  { code: 'CR', name: 'Costa Rica', aliases: ['CRI'] },

  // --- Europe ---
  { code: 'IE', name: 'Ireland', aliases: ['REPUBLIC OF IRELAND', 'IRL'] },
  { code: 'DE', name: 'Germany', aliases: ['DEU', 'DEUTSCHLAND'] },
  { code: 'FR', name: 'France', aliases: ['FRA'] },
  { code: 'NL', name: 'Netherlands', aliases: ['HOLLAND', 'NLD'] },
  { code: 'BE', name: 'Belgium', aliases: ['BEL'] },
  { code: 'ES', name: 'Spain', aliases: ['ESP'] },
  { code: 'IT', name: 'Italy', aliases: ['ITA'] },
  { code: 'PT', name: 'Portugal', aliases: ['PRT'] },
  { code: 'PL', name: 'Poland', aliases: ['POL'] },
  { code: 'CZ', name: 'Czech Republic', aliases: ['CZECHIA', 'CZE'] },
  { code: 'HU', name: 'Hungary', aliases: ['HUN'] },
  { code: 'RO', name: 'Romania', aliases: ['ROU'] },
  { code: 'SE', name: 'Sweden', aliases: ['SWE'] },
  { code: 'NO', name: 'Norway', aliases: ['NOR'] },
  { code: 'DK', name: 'Denmark', aliases: ['DNK'] },
  { code: 'FI', name: 'Finland', aliases: ['FIN'] },
  { code: 'CH', name: 'Switzerland', aliases: ['CHE'] },
  { code: 'AT', name: 'Austria', aliases: ['AUT'] },

  // --- Asia-Pacific, Middle East, Africa ---
  { code: 'IN', name: 'India', aliases: ['IND'] },
  { code: 'CN', name: 'China', aliases: ['PRC', 'CHN', 'PEOPLES REPUBLIC OF CHINA'] },
  { code: 'HK', name: 'Hong Kong', aliases: ['HKG'] },
  { code: 'JP', name: 'Japan', aliases: ['JPN'] },
  { code: 'KR', name: 'South Korea', aliases: ['KOREA REPUBLIC OF', 'REPUBLIC OF KOREA', 'KOR'] },
  { code: 'SG', name: 'Singapore', aliases: ['SGP'] },
  { code: 'MY', name: 'Malaysia', aliases: ['MYS'] },
  { code: 'PH', name: 'Philippines', aliases: ['PHL'] },
  { code: 'ID', name: 'Indonesia', aliases: ['IDN'] },
  { code: 'AU', name: 'Australia', aliases: ['AUS'] },
  { code: 'NZ', name: 'New Zealand', aliases: ['NZL'] },
  { code: 'IL', name: 'Israel', aliases: ['ISR'] },
  { code: 'AE', name: 'United Arab Emirates', aliases: ['UAE', 'ARE'] },
  { code: 'TR', name: 'Turkey', aliases: ['TURKIYE', 'TUR'] },
  { code: 'ZA', name: 'South Africa', aliases: ['ZAF'] },
];

/**
 * Territories a rate card may or may not be intended to govern.
 *
 * Empty by default, and that default is the point: whether a "USA" card
 * applies to Puerto Rico actuals is a commercial decision, not a data one.
 * Folding PR into US here would silently apply one market's bands to another's
 * work, and Puerto Rico's volume is small enough against the mainland's that
 * nobody would notice it had happened.
 *
 * To roll a territory up, add it — `PR: 'US'` — and every comparison treats
 * the two as one market from then on.
 */
export const TERRITORY_ROLLUP: Record<string, string> = {};

/** Punctuation and spacing vary; the comparison should not. */
const normalizeInput = (raw: string): string =>
  (raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/^THE /, '')
    .trim();

/** alias -> ISO code, built once. */
const LOOKUP: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const def of COUNTRIES) {
    for (const key of [def.code, def.name, ...def.aliases]) {
      const normalized = normalizeInput(key);
      if (!normalized) continue;
      // A collision means two definitions claim one spelling — a table bug, and
      // the first registration wins so behaviour stays deterministic.
      if (!map.has(normalized)) map.set(normalized, def.code);
    }
  }
  return map;
})();

const BY_CODE: Map<string, CountryDefinition> = new Map(COUNTRIES.map((c) => [c.code, c]));

/**
 * The canonical ISO code for a country value from either vocabulary, or null
 * when the table does not recognise it.
 *
 * Null is a real answer and callers must handle it rather than substituting a
 * guess: a value that cannot be normalized should keep its own identity and be
 * reported, not be folded into whichever country looks closest.
 */
export const normalizeCountry = (raw: string): string | null => {
  const key = normalizeInput(raw);
  if (!key) return null;
  const code = LOOKUP.get(key) ?? null;
  return code ? TERRITORY_ROLLUP[code] ?? code : null;
};

/**
 * A stable grouping key for any country value, recognised or not.
 *
 * Recognised values collapse onto their ISO code, so "USA" and "UNITED STATES
 * OF AMERICA" become one group. Unrecognised values group under their own
 * normalized spelling rather than disappearing — the report then shows them as
 * a separate market, which is visible and therefore fixable.
 */
export const countryKey = (raw: string): string => normalizeCountry(raw) ?? normalizeInput(raw);

/** How a country key is shown. Unrecognised keys are shown as they arrived. */
export const describeCountry = (key: string): string => {
  if (!key) return 'Unspecified';
  const def = BY_CODE.get(key);
  if (def) return def.name;
  // Title-case an unrecognised value so it reads as a name rather than a shout.
  return key
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
};

/** True when the table recognises the value. */
export const isKnownCountry = (raw: string): boolean => normalizeCountry(raw) !== null;

/**
 * Distinct country values the table failed to recognise.
 *
 * The table is deliberately not an exhaustive ISO list, so this is how it grows
 * — against the vocabulary the data actually uses rather than a guess at it.
 * Anything this returns is a market currently reporting under its own raw
 * spelling, and will not join to a rate card tagged any other way.
 */
export const collectUnmappedCountries = (values: (string | undefined | null)[]): string[] => {
  const unmapped = new Set<string>();
  for (const value of values) {
    const raw = (value || '').trim();
    if (!raw) continue;
    if (!isKnownCountry(raw)) unmapped.add(raw);
  }
  return Array.from(unmapped).sort();
};

/** Every country the table knows, for building a picker. */
export const knownCountries = (): { code: string; name: string }[] =>
  COUNTRIES.map(({ code, name }) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name));

// ---------------------------------------------------------------------------
// Currency
//
// A rate card records no currency of its own — it carries a country, and the
// currency follows from it. That inference has to be explicit and visible,
// because getting it wrong turns an exchange rate into a compliance finding:
// a CAD rate of 70 against a USD band of 55-65 reads as a violation and is not
// one.
// ---------------------------------------------------------------------------

/**
 * The currency a card for this country is priced in.
 *
 * Puerto Rico is the case worth noting: it is its own market with its own
 * client rows, but it uses the US dollar, so a PR card compares in USD.
 */
const COUNTRY_CURRENCY: Record<string, string> = {
  US: 'USD', PR: 'USD',
  CA: 'CAD',
  GB: 'GBP',
  IN: 'INR',
  // The euro area, as far as this table covers it.
  IE: 'EUR', DE: 'EUR', FR: 'EUR', NL: 'EUR', BE: 'EUR', ES: 'EUR',
  IT: 'EUR', PT: 'EUR', AT: 'EUR', FI: 'EUR',
  // Everything else keeps its own currency, which the actuals may not carry a
  // conversion for. Listed rather than omitted so the gap is legible.
  MX: 'MXN', BR: 'BRL', AR: 'ARS', CL: 'CLP', CO: 'COP', CR: 'CRC',
  PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', SE: 'SEK', NO: 'NOK',
  DK: 'DKK', CH: 'CHF', CN: 'CNY', HK: 'HKD', JP: 'JPY', KR: 'KRW',
  SG: 'SGD', MY: 'MYR', PH: 'PHP', ID: 'IDR', AU: 'AUD', NZ: 'NZD',
  IL: 'ILS', AE: 'AED', TR: 'TRY', ZA: 'ZAR',
};

/**
 * The currency to compare a card in, from its country value.
 *
 * Returns null when the country is unrecognised. Null must not be treated as
 * USD: an unknown market compared in the wrong currency produces confident
 * nonsense, and reporting it as uncomparable is the honest outcome.
 */
export const currencyForCountry = (rawCountry: string): string | null => {
  const code = normalizeCountry(rawCountry);
  return code ? COUNTRY_CURRENCY[code] ?? null : null;
};

// ---------------------------------------------------------------------------
// Region
//
// The market groupings a rate card recommendation is reported in. Coarser than
// the regional report's geography, which works inside a country from the
// actuals; these group whole countries, so they need nothing but the card.
// ---------------------------------------------------------------------------

/** Display order, west to east, the way the recommendation deck reads. */
export const REGIONS = ['N. America', 'LATAM', 'W. Europe', 'CEE', 'MEA', 'APAC'] as const;

/** Where a country the table does not place is reported, rather than dropped. */
export const OTHER_REGION = 'Other';

const COUNTRY_REGION: Record<string, (typeof REGIONS)[number]> = {
  US: 'N. America', CA: 'N. America', PR: 'N. America',
  MX: 'LATAM', BR: 'LATAM', AR: 'LATAM', CL: 'LATAM', CO: 'LATAM', CR: 'LATAM',
  GB: 'W. Europe', IE: 'W. Europe', DE: 'W. Europe', FR: 'W. Europe', NL: 'W. Europe',
  BE: 'W. Europe', ES: 'W. Europe', IT: 'W. Europe', PT: 'W. Europe', SE: 'W. Europe',
  NO: 'W. Europe', DK: 'W. Europe', FI: 'W. Europe', CH: 'W. Europe', AT: 'W. Europe',
  PL: 'CEE', CZ: 'CEE', HU: 'CEE', RO: 'CEE',
  IL: 'MEA', AE: 'MEA', TR: 'MEA', ZA: 'MEA',
  IN: 'APAC', CN: 'APAC', HK: 'APAC', JP: 'APAC', KR: 'APAC', SG: 'APAC',
  MY: 'APAC', PH: 'APAC', ID: 'APAC', AU: 'APAC', NZ: 'APAC',
};

/**
 * The region a country value reports under. An unrecognised country goes to
 * `OTHER_REGION` so its lines stay visible — the same rule as the country key.
 */
export const regionForCountry = (rawCountry: string): string => {
  const code = normalizeCountry(rawCountry);
  return (code && COUNTRY_REGION[code]) || OTHER_REGION;
};
