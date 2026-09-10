import { AssignmentActualRow, payRateFieldFor } from '../types/domoDatasets';
import { ClientAlias, RateCardRecord, TitleAlias } from '../types/rateCard';
import { clientCodeFor } from './clientMatchService';
import { countryKey, currencyForCountry } from './countryService';
import { normalizeJobTitle } from './titleService';
import { actualTitleKeyFor } from './titleMatchService';

/**
 * What is in scope, and what rate to compare it at.
 *
 * Shared by the coverage and compliance reports rather than implemented twice.
 * The two have to agree on which assignments count and at what rate, because a
 * coverage figure and a compliance figure that disagree about the population
 * are both unusable — and nobody can tell which one is wrong. This is the one
 * place that decision is made.
 */

export interface CardBand {
  clientCode: string;
  clientLabel: string;
  /** The card's own title, for display. */
  title: string;
  laborType?: string;
  minRate: number;
  maxRate: number;
  /** Several card rows share this title; the band is the widest of them. */
  rowCount: number;
}

export interface ResolvedScope {
  rateYear: string;
  availableYears: string[];
  /** Resolved client code to the card's own label. */
  clientLabels: Map<string, string>;
  /** `${clientCode}||${countryKey}` pairs the cards cover. */
  scopeKeys: Set<string>;
  countries: Set<string>;
  /** Comparison currency per country, inferred from the country. */
  currencyByCountry: Map<string, string | null>;
  /** Card bands by `${clientCode}||${titleKey}`, keyed on the *joined* title. */
  cardBands: Map<string, CardBand>;
  /** Card clients with no confirmed alias; their cards cannot be compared. */
  unresolvedClients: string[];
  /** Every comparison currency the scope spans. More than one is a problem. */
  currencies: Set<string>;
}

/** Why an assignment row is not being compared. */
export type ExclusionReason =
  | 'client not in scope, or unresolved'
  | 'country not in scope'
  | 'card year does not match'
  | 'no cleaned title'
  | 'no hours recorded yet'
  | 'no comparable rate in the card currency';

export interface ScopedRow {
  row: AssignmentActualRow;
  clientCode: string;
  country: string;
  titleKey: string;
  /** The pay rate in the card's currency. */
  rate: number;
  currency: string;
  hours: number;
  /** The card band for this title, when one exists. */
  band?: CardBand;
}

/**
 * Resolve the cards into a scope.
 *
 * `cards` is expected already narrowed by the dashboard's client and country
 * selectors. This picks the rate year, resolves clients onto codes, redirects
 * card titles through any confirmed match, and widens the band where several
 * card rows share a title.
 */
export const resolveScope = (
  cards: RateCardRecord[],
  clientAliases: ClientAlias[],
  titleAliases: TitleAlias[],
  requestedYear?: string
): ResolvedScope => {
  const availableYears = Array.from(new Set(cards.map((c) => c.rateYear).filter(Boolean))).sort();
  const rateYear =
    requestedYear && availableYears.includes(requestedYear)
      ? requestedYear
      : availableYears[availableYears.length - 1] ?? '';

  const clientLabels = new Map<string, string>();
  const scopeKeys = new Set<string>();
  const countries = new Set<string>();
  const currencyByCountry = new Map<string, string | null>();
  const cardBands = new Map<string, CardBand>();
  const unresolved = new Set<string>();
  const currencies = new Set<string>();

  for (const card of cards) {
    if (card.rateYear !== rateYear) continue;

    const clientName = (card.client || '').trim();
    const code = clientCodeFor(clientName, clientAliases);
    if (!code) {
      if (clientName) unresolved.add(clientName);
      continue;
    }
    clientLabels.set(code, clientName);

    const country = countryKey(card.country || '');
    countries.add(country);
    scopeKeys.add(`${code}||${country}`);
    if (!currencyByCountry.has(country)) {
      const ccy = currencyForCountry(card.country || '');
      currencyByCountry.set(country, ccy);
      if (ccy) currencies.add(ccy);
    }

    const titleKey = normalizeJobTitle(card.jobTitle || '');
    if (!titleKey) continue;

    // A confirmed title match redirects the card onto the actuals title it was
    // paired with, so the band is found by the name the actuals use.
    const joinKey = actualTitleKeyFor(code, card.jobTitle || '', titleAliases) ?? titleKey;
    const key = `${code}||${joinKey}`;

    const existing = cardBands.get(key);
    if (existing) {
      // Widen rather than pick. Two card rows for one title — a labor type
      // split, or two card titles resolving to the same actuals title — bound
      // a range together, and choosing one would call the other a violation.
      existing.minRate = Math.min(existing.minRate, card.minRate);
      existing.maxRate = Math.max(existing.maxRate, card.maxRate);
      existing.rowCount += 1;
    } else {
      cardBands.set(key, {
        clientCode: code,
        clientLabel: clientName,
        title: card.jobTitle,
        laborType: card.laborType,
        minRate: card.minRate,
        maxRate: card.maxRate,
        rowCount: 1,
      });
    }
  }

  return {
    rateYear,
    availableYears,
    clientLabels,
    scopeKeys,
    countries,
    currencyByCountry,
    cardBands,
    unresolvedClients: Array.from(unresolved).sort(),
    currencies,
  };
};

/**
 * Place one assignment row in the scope, or say why it is out.
 *
 * The rate returned is in the card's currency, taken from the source's own
 * conversion. Where no converted column exists the row is excluded rather than
 * compared at its local rate — comparing 95 CAD to a 60-80 USD band produces a
 * violation that is really an exchange rate, and that is worse than a gap.
 */
export const scopeRow = (
  row: AssignmentActualRow,
  scope: ResolvedScope
): { ok: true; scoped: ScopedRow } | { ok: false; reason: ExclusionReason } => {
  const clientCode = (row.rsr_client_code || '').trim();
  if (!clientCode || !scope.clientLabels.has(clientCode)) {
    return { ok: false, reason: 'client not in scope, or unresolved' };
  }

  const country = countryKey(row.rsr_country || '');
  if (!scope.scopeKeys.has(`${clientCode}||${country}`)) {
    return { ok: false, reason: 'country not in scope' };
  }

  if ((row.card_year || '') !== scope.rateYear) {
    return { ok: false, reason: 'card year does not match' };
  }

  const titleKey = normalizeJobTitle(row.title_cleaned || '');
  if (!titleKey) return { ok: false, reason: 'no cleaned title' };

  const hours = typeof row.hours_to_date === 'number' ? row.hours_to_date : 0;
  if (hours <= 0) return { ok: false, reason: 'no hours recorded yet' };

  const currency = scope.currencyByCountry.get(country) ?? null;
  const field = currency ? payRateFieldFor(currency) : null;
  const converted = field ? (row[field] as number | null) : null;

  if (typeof converted !== 'number') {
    // Fall back to the local rate only when it is already in the comparison
    // currency; otherwise there is nothing valid to compare.
    if (currency && row.currency === currency && typeof row.pay_rate_st_hr === 'number') {
      return {
        ok: true,
        scoped: {
          row,
          clientCode,
          country,
          titleKey,
          rate: row.pay_rate_st_hr,
          currency,
          hours,
          band: scope.cardBands.get(`${clientCode}||${titleKey}`),
        },
      };
    }
    return { ok: false, reason: 'no comparable rate in the card currency' };
  }

  return {
    ok: true,
    scoped: {
      row,
      clientCode,
      country,
      titleKey,
      rate: converted,
      currency: currency!,
      hours,
      band: scope.cardBands.get(`${clientCode}||${titleKey}`),
    },
  };
};

/** Scope every row at once, tallying the exclusions by reason. */
export const scopeRows = (
  actuals: AssignmentActualRow[],
  scope: ResolvedScope
): { scoped: ScopedRow[]; excluded: { reason: string; count: number }[] } => {
  const scoped: ScopedRow[] = [];
  const tally = new Map<ExclusionReason, number>();

  for (const row of actuals) {
    const result = scopeRow(row, scope);
    if (result.ok) scoped.push(result.scoped);
    else tally.set(result.reason, (tally.get(result.reason) ?? 0) + 1);
  }

  return {
    scoped,
    excluded: Array.from(tally, ([reason, count]) => ({ reason, count })).sort(
      (a, b) => b.count - a.count
    ),
  };
};

/** The one comparison currency in scope, or null when it spans several. */
export const singleCurrency = (scope: ResolvedScope): string | null =>
  scope.currencies.size === 1 ? Array.from(scope.currencies)[0] : null;
