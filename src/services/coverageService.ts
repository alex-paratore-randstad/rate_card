import { AssignmentActualRow } from '../types/domoDatasets';
import { ClientAlias, RateCardRecord, TitleAlias } from '../types/rateCard';
import { describeCountry } from './countryService';
import { resolveScope, scopeRows } from './scopeService';

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
 * No rate comparison happens here on purpose. This report exercises the
 * client, country and title joins and nothing else, so that when a compliance
 * verdict is built on those joins there is already evidence they hold. A
 * compliance percentage computed over a broken join looks entirely reasonable.
 *
 * Scoping is delegated to scopeService, shared with the compliance report —
 * two reports disagreeing about the population would leave nobody able to say
 * which was wrong.
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
 * selectors; the shared scope narrows further to one rate year, because a card
 * governs a year and comparing 2025 bands against 2026 work answers nothing.
 */
export const buildCoverageReport = (
  cards: RateCardRecord[],
  actuals: AssignmentActualRow[],
  aliases: ClientAlias[],
  titleAliases: TitleAlias[] = [],
  requestedYear?: string
): CoverageReport => {
  const scope = resolveScope(cards, aliases, titleAliases, requestedYear);
  const { scoped, excluded } = scopeRows(actuals, scope);

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

  for (const item of scoped) {
    const key = `${item.clientCode}||${item.titleKey}`;
    let agg = actualByKey.get(key);
    if (!agg) {
      agg = {
        clientCode: item.clientCode,
        titleKey: item.titleKey,
        title: item.row.title_cleaned,
        assignments: new Set(),
        hours: 0,
        payDollars: 0,
        currencies: new Set(),
      };
      actualByKey.set(key, agg);
    }
    agg.assignments.add(item.row.assignment_unique_key);
    agg.hours += item.hours;
    // Computed from the comparison rate, not the ETL's pay_dollars, which is
    // rate x hours in the local currency.
    agg.payDollars += item.rate * item.hours;
    agg.currencies.add(item.currency);
  }

  // --- outer join of card bands against aggregated actuals -----------------
  const rows: CoverageRow[] = [];
  const allKeys = new Set([...scope.cardBands.keys(), ...actualByKey.keys()]);

  for (const key of allKeys) {
    const band = scope.cardBands.get(key);
    const actual = actualByKey.get(key);

    const clientCode = band?.clientCode ?? actual!.clientCode;
    const base: CoverageRow = {
      clientCode,
      clientLabel: scope.clientLabels.get(clientCode) ?? clientCode,
      title: band?.title ?? actual!.title,
      titleKey: key.split('||')[1] ?? '',
      state: band && actual ? 'matched' : band ? 'card-only' : 'actuals-only',
    };

    if (band) {
      base.cardTitle = band.title;
      base.cardLaborType = band.laborType;
      base.cardMinRate = band.minRate;
      base.cardMaxRate = band.maxRate;
      base.cardRowCount = band.rowCount;
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

  return {
    rows,
    rateYear: scope.rateYear,
    availableYears: scope.availableYears,
    unresolvedClients: scope.unresolvedClients,
    countries: Array.from(scope.countries).sort(),
    actualsConsidered: scoped.length,
    actualsExcluded: excluded,
    totals: {
      coveredHours,
      uncoveredHours,
      coveredShare: totalHours > 0 ? coveredHours / totalHours : null,
      cardRowsWithActuals: covered.length,
      cardRowsWithout: rows.filter((r) => r.state === 'card-only').length,
      titlesWithoutCard: uncovered.length,
    },
    currencyWarning:
      scope.currencies.size > 1
        ? `Hours in scope span ${scope.currencies.size} comparison currencies (${Array.from(
            scope.currencies
          )
            .sort()
            .join(', ')}). Rates shown are not comparable across them — scope to one country.`
        : undefined,
  };
};

/** Country names for the report header. */
export const describeScope = (countries: string[]): string =>
  countries.length ? countries.map(describeCountry).join(', ') : 'no country';
