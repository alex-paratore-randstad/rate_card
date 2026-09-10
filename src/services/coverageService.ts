import { AssignmentActualRow } from '../types/domoDatasets';
import { ClientAlias, RateCardRecord, TitleAlias } from '../types/rateCard';
import { clientCodeFor } from './clientMatchService';
import { countryKey, describeCountry } from './countryService';
import { normalizeJobTitle } from './titleService';
import { actualTitleKeyFor } from './titleMatchService';

/**
 * Card coverage: which work a rate card actually governs.
 *
 * Two questions, and the report answers both because each is only meaningful
 * beside the other:
 *
 *   - Hours running against titles with no card row. Work nobody priced.
 *   - Card rows with no hours behind them. Bands maintained for work that is
 *     not happening, or a title that failed to match.
 *
 * No rate comparison happens here on purpose. This report exercises the client,
 * country and title joins and nothing else, so that when a variance number is
 * built on those joins there is already evidence they hold. A compliance
 * percentage computed on a broken join looks entirely reasonable.
 */

export type CoverageState =
  /** A card row and actual hours agree on client, country, year and title. */
  | 'matched'
  /** Hours with no card row for that title. The real coverage gap. */
  | 'actuals-only'
  /** A card row with no hours. Unpriced work, or a title that did not match. */
  | 'card-only';

export interface CoverageRow {
  clientCode: string;
  clientLabel: string;
  /** Title as it reads on whichever side supplied it. */
  title: string;
  titleKey: string;
  state: CoverageState;

  // Card side
  cardTitle?: string;
  cardLaborType?: string;
  cardMinRate?: number;
  cardMaxRate?: number;
  /** More than one card row shares this title; the band shown is the widest. */
  cardRowCount?: number;

  // Actuals side
  assignments?: number;
  hours?: number;
  payDollars?: number;
  /** Hours-weighted, so a long assignment counts for more than a short one. */
  weightedPayRate?: number;
  currencies?: string[];
}

export interface CoverageTotals {
  /** Hours whose title has a card row. */
  coveredHours: number;
  /** Hours whose title has none. */
  uncoveredHours: number;
  /** Share of hours a card governs, 0 to 1. Null when there are no hours. */
  coveredShare: number | null;
  cardRowsWithActuals: number;
  cardRowsWithout: number;
  titlesWithoutCard: number;
}

export interface CoverageReport {
  rows: CoverageRow[];
  totals: CoverageTotals;
  rateYear: string;
  /** Rate years present across the scoped cards, for the selector. */
  availableYears: string[];
  /**
   * Card clients with no confirmed alias. Their cards cannot be compared at
   * all, and saying so is the difference between an empty report and a wrong
   * one.
   */
  unresolvedClients: string[];
  /** Countries in scope, canonical, for the header. */
  countries: string[];
  /** Actuals rows considered, and why the rest were set aside. */
  actualsConsidered: number;
  actualsExcluded: { reason: string; count: number }[];
  /** Set when scoped hours span more than one currency. */
  currencyWarning?: string;
}

const sum = (values: number[]): number => values.reduce((a, b) => a + (b || 0), 0);

/**
 * Build the report.
 *
 * `cards` is expected already scoped by the dashboard's client and country
 * selectors; this narrows further to one rate year, because a card governs a
 * year and comparing 2025 bands against 2026 work answers nothing.
 */
export const buildCoverageReport = (
  cards: RateCardRecord[],
  actuals: AssignmentActualRow[],
  aliases: ClientAlias[],
  titleAliases: TitleAlias[] = [],
  requestedYear?: string
): CoverageReport => {
  const availableYears = Array.from(new Set(cards.map((c) => c.rateYear).filter(Boolean))).sort();
  const rateYear = requestedYear && availableYears.includes(requestedYear)
    ? requestedYear
    : availableYears[availableYears.length - 1] ?? '';

  const yearCards = cards.filter((c) => c.rateYear === rateYear);

  // --- resolve each card client onto a code -------------------------------
  const unresolved = new Set<string>();
  const codeToLabel = new Map<string, string>();
  const scopeKeys = new Set<string>(); // `${clientCode}||${countryKey}`
  const countries = new Set<string>();

  interface CardAgg {
    clientCode: string;
    clientLabel: string;
    titleKey: string;
    title: string;
    laborType?: string;
    minRate: number;
    maxRate: number;
    rowCount: number;
  }
  const cardByKey = new Map<string, CardAgg>();

  for (const card of yearCards) {
    const clientName = (card.client || '').trim();
    const code = clientCodeFor(clientName, aliases);
    if (!code) {
      if (clientName) unresolved.add(clientName);
      continue;
    }
    codeToLabel.set(code, clientName);

    const country = countryKey(card.country || '');
    countries.add(country);
    scopeKeys.add(`${code}||${country}`);

    const titleKey = normalizeJobTitle(card.jobTitle || '');
    if (!titleKey) continue;

    // A confirmed title match redirects the card onto the actuals title it was
    // paired with. Without this the matcher would have no effect on the report
    // it exists to improve. Two card titles resolving to one actuals title
    // merge here, which widens the band — the same treatment duplicate card
    // rows already get.
    const joinKey = actualTitleKeyFor(code, card.jobTitle || '', titleAliases) ?? titleKey;

    const key = `${code}||${joinKey}`;
    const existing = cardByKey.get(key);
    if (existing) {
      // Several card rows for one title — different labor types, or a country
      // split. Widen the band rather than pick one, and record that it happened
      // so the number is not mistaken for a single published band.
      existing.minRate = Math.min(existing.minRate, card.minRate);
      existing.maxRate = Math.max(existing.maxRate, card.maxRate);
      existing.rowCount += 1;
    } else {
      cardByKey.set(key, {
        clientCode: code,
        clientLabel: clientName,
        titleKey: joinKey,
        title: card.jobTitle,
        laborType: card.laborType,
        minRate: card.minRate,
        maxRate: card.maxRate,
        rowCount: 1,
      });
    }
  }

  // --- narrow the actuals to the same scope -------------------------------
  interface ActualAgg {
    clientCode: string;
    titleKey: string;
    title: string;
    assignments: Set<string>;
    hours: number;
    payDollars: number;
    currencies: Set<string>;
  }
  const actualByKey = new Map<string, ActualAgg>();
  const excluded = { client: 0, country: 0, year: 0, title: 0, hours: 0 };
  let considered = 0;

  for (const row of actuals) {
    const code = (row.rsr_client_code || '').trim();
    if (!code || !codeToLabel.has(code)) {
      excluded.client += 1;
      continue;
    }
    const country = countryKey(row.rsr_country || '');
    if (!scopeKeys.has(`${code}||${country}`)) {
      excluded.country += 1;
      continue;
    }
    if ((row.card_year || '') !== rateYear) {
      excluded.year += 1;
      continue;
    }
    const titleKey = normalizeJobTitle(row.title_cleaned || '');
    if (!titleKey) {
      excluded.title += 1;
      continue;
    }
    const hours = typeof row.hours_to_date === 'number' ? row.hours_to_date : 0;
    if (hours <= 0) {
      // Kept out of the aggregate but counted: an assignment with no hours yet
      // cannot weight anything, and silently including it would drag the
      // weighted rate toward zero.
      excluded.hours += 1;
      continue;
    }

    considered += 1;
    const key = `${code}||${titleKey}`;
    let agg = actualByKey.get(key);
    if (!agg) {
      agg = {
        clientCode: code,
        titleKey,
        title: row.title_cleaned,
        assignments: new Set(),
        hours: 0,
        payDollars: 0,
        currencies: new Set(),
      };
      actualByKey.set(key, agg);
    }
    agg.assignments.add(row.assignment_unique_key);
    agg.hours += hours;
    agg.payDollars += typeof row.pay_dollars === 'number' ? row.pay_dollars : 0;
    if (row.currency) agg.currencies.add(row.currency);
  }

  // --- outer join ---------------------------------------------------------
  const rows: CoverageRow[] = [];
  const allKeys = new Set([...cardByKey.keys(), ...actualByKey.keys()]);

  for (const key of allKeys) {
    const card = cardByKey.get(key);
    const actual = actualByKey.get(key);

    const clientCode = card?.clientCode ?? actual!.clientCode;
    const base: CoverageRow = {
      clientCode,
      clientLabel: codeToLabel.get(clientCode) ?? clientCode,
      title: card?.title ?? actual!.title,
      titleKey: card?.titleKey ?? actual!.titleKey,
      state: card && actual ? 'matched' : card ? 'card-only' : 'actuals-only',
    };

    if (card) {
      base.cardTitle = card.title;
      base.cardLaborType = card.laborType;
      base.cardMinRate = card.minRate;
      base.cardMaxRate = card.maxRate;
      base.cardRowCount = card.rowCount;
    }
    if (actual) {
      base.assignments = actual.assignments.size;
      base.hours = actual.hours;
      base.payDollars = actual.payDollars;
      base.weightedPayRate = actual.hours > 0 ? actual.payDollars / actual.hours : undefined;
      base.currencies = Array.from(actual.currencies).sort();
    }
    rows.push(base);
  }

  // Largest hours first — the gaps worth acting on are the expensive ones.
  rows.sort(
    (a, b) =>
      (b.hours ?? 0) - (a.hours ?? 0) ||
      a.clientLabel.localeCompare(b.clientLabel) ||
      a.title.localeCompare(b.title)
  );

  const covered = rows.filter((r) => r.state === 'matched');
  const uncovered = rows.filter((r) => r.state === 'actuals-only');
  const coveredHours = sum(covered.map((r) => r.hours ?? 0));
  const uncoveredHours = sum(uncovered.map((r) => r.hours ?? 0));
  const totalHours = coveredHours + uncoveredHours;

  const currencies = new Set<string>();
  for (const row of rows) for (const c of row.currencies ?? []) currencies.add(c);

  return {
    rows,
    rateYear,
    availableYears,
    unresolvedClients: Array.from(unresolved).sort(),
    countries: Array.from(countries).sort(),
    actualsConsidered: considered,
    actualsExcluded: [
      { reason: 'client not in scope, or unresolved', count: excluded.client },
      { reason: 'country not in scope', count: excluded.country },
      { reason: `card year is not ${rateYear || 'the selected year'}`, count: excluded.year },
      { reason: 'no cleaned title', count: excluded.title },
      { reason: 'no hours recorded yet', count: excluded.hours },
    ].filter((e) => e.count > 0),
    totals: {
      coveredHours,
      uncoveredHours,
      coveredShare: totalHours > 0 ? coveredHours / totalHours : null,
      cardRowsWithActuals: covered.length,
      cardRowsWithout: rows.filter((r) => r.state === 'card-only').length,
      titlesWithoutCard: uncovered.length,
    },
    currencyWarning:
      currencies.size > 1
        ? `Hours in scope span ${currencies.size} currencies (${Array.from(currencies)
            .sort()
            .join(', ')}). Rates shown are not comparable across them — scope to one country.`
        : undefined,
  };
};

/** Country names for the report header. */
export const describeScope = (countries: string[]): string =>
  countries.length ? countries.map(describeCountry).join(', ') : 'no country';
