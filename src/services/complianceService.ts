import { AssignmentActualRow } from '../types/domoDatasets';
import { ClientAlias, RateCardRecord, TitleAlias } from '../types/rateCard';
import { ResolvedScope, resolveScope, scopeRows, singleCurrency } from './scopeService';

/**
 * Card compliance: whether the work is being paid inside the band it was priced at.
 *
 * The one decision that makes this report right or wrong is where the
 * comparison happens. Every assignment is classified individually and the
 * hours are then summed by class — a title's *average* rate is never compared
 * to its band.
 *
 * That distinction is not academic. A title whose weighted average sits
 * comfortably inside 60-90 can have a third of its hours above 90, with the
 * high and low assignments cancelling out; averaging first hides exactly the
 * dispersion the report exists to find, and reports it as compliant. Where
 * that happens the title is flagged as scattered rather than passed.
 */

export type ComplianceClass = 'below-min' | 'in-band' | 'above-max';

export interface ComplianceAssignment {
  assignmentKey: string;
  /** The card's title, which is what the band belongs to. */
  cardTitle: string;
  /** The title the actuals use, which may differ. */
  actualTitle: string;
  clientLabel: string;
  rate: number;
  currency: string;
  hours: number;
  cardMinRate: number;
  cardMaxRate: number;
  verdict: ComplianceClass;
  /**
   * Money the band would have saved, or cost: (rate - max) x hours above the
   * band, (min - rate) x hours below it, zero inside. Signed positive in both
   * directions — the class says which way.
   */
  varianceAmount: number;
  /** Still correctable. A finding on a closed assignment is history. */
  isOpen: boolean;
  supplier?: string;
  stateProvince?: string;
}

export interface ComplianceTitleRow {
  cardTitle: string;
  actualTitle: string;
  clientCode: string;
  clientLabel: string;
  cardMinRate: number;
  cardMaxRate: number;
  cardRowCount: number;
  currency: string;

  assignments: number;
  hours: number;
  hoursBelow: number;
  hoursIn: number;
  hoursAbove: number;

  /** Hours-weighted, for context only — never the basis of the verdict. */
  weightedRate: number;
  observedMin: number;
  observedMax: number;

  excessAmount: number;
  shortfallAmount: number;
  /** Excess on assignments that are still open, and so still correctable. */
  openExcessAmount: number;

  /**
   * Hours sit on both sides of the band, or outside it while the weighted
   * average sits inside. The average alone would have called this compliant.
   */
  scattered: boolean;
}

export interface ComplianceTotals {
  hours: number;
  hoursBelow: number;
  hoursIn: number;
  hoursAbove: number;
  /** Share of compared hours inside the band, 0 to 1. Null when none. */
  inBandShare: number | null;
  excessAmount: number;
  shortfallAmount: number;
  openExcessAmount: number;
  assignments: number;
  titlesScattered: number;
}

export interface ComplianceReport {
  rateYear: string;
  availableYears: string[];
  countries: string[];
  /** The single comparison currency, or null when the scope spans several. */
  currency: string | null;
  titles: ComplianceTitleRow[];
  totals: ComplianceTotals;
  /** Above-band assignments ranked by money, the actionable list. */
  worstAssignments: ComplianceAssignment[];
  /** Hours in scope whose title has no card band, so nothing to judge them by. */
  unbandedHours: number;
  unbandedTitles: number;
  unresolvedClients: string[];
  excluded: { reason: string; count: number }[];
  currencyWarning?: string;
}

const classify = (rate: number, min: number, max: number): ComplianceClass => {
  if (max > 0 && rate > max) return 'above-max';
  if (min > 0 && rate < min) return 'below-min';
  return 'in-band';
};

interface TitleAgg {
  row: ComplianceTitleRow;
  weighted: number;
}

/**
 * Build the report.
 *
 * Scoping is delegated to scopeService so this and the coverage report cannot
 * disagree about which assignments count or at what rate.
 */
export const buildComplianceReport = (
  cards: RateCardRecord[],
  actuals: AssignmentActualRow[],
  clientAliases: ClientAlias[],
  titleAliases: TitleAlias[] = [],
  requestedYear?: string
): ComplianceReport => {
  const scope: ResolvedScope = resolveScope(cards, clientAliases, titleAliases, requestedYear);
  const { scoped, excluded } = scopeRows(actuals, scope);

  const byTitle = new Map<string, TitleAgg>();
  const assignments: ComplianceAssignment[] = [];
  let unbandedHours = 0;
  const unbandedTitles = new Set<string>();

  for (const item of scoped) {
    if (!item.band) {
      // In scope, but its title has no card band. Not a compliance failure —
      // there is nothing to judge it against. The coverage report is where
      // this belongs, and it is counted here only so the two reports add up.
      unbandedHours += item.hours;
      unbandedTitles.add(`${item.clientCode}||${item.titleKey}`);
      continue;
    }

    const { band, rate, hours } = item;
    const verdict = classify(rate, band.minRate, band.maxRate);
    const variance =
      verdict === 'above-max'
        ? (rate - band.maxRate) * hours
        : verdict === 'below-min'
        ? (band.minRate - rate) * hours
        : 0;
    const isOpen = item.row.is_open === 1;

    assignments.push({
      assignmentKey: item.row.assignment_unique_key,
      cardTitle: band.title,
      actualTitle: item.row.title_cleaned,
      clientLabel: band.clientLabel,
      rate,
      currency: item.currency,
      hours,
      cardMinRate: band.minRate,
      cardMaxRate: band.maxRate,
      verdict,
      varianceAmount: variance,
      isOpen,
      supplier: item.row.rsr_supplier || undefined,
      stateProvince: item.row.state_province || undefined,
    });

    const key = `${item.clientCode}||${item.titleKey}`;
    let agg = byTitle.get(key);
    if (!agg) {
      agg = {
        weighted: 0,
        row: {
          cardTitle: band.title,
          actualTitle: item.row.title_cleaned,
          clientCode: item.clientCode,
          clientLabel: band.clientLabel,
          cardMinRate: band.minRate,
          cardMaxRate: band.maxRate,
          cardRowCount: band.rowCount,
          currency: item.currency,
          assignments: 0,
          hours: 0,
          hoursBelow: 0,
          hoursIn: 0,
          hoursAbove: 0,
          weightedRate: 0,
          observedMin: rate,
          observedMax: rate,
          excessAmount: 0,
          shortfallAmount: 0,
          openExcessAmount: 0,
          scattered: false,
        },
      };
      byTitle.set(key, agg);
    }

    const r = agg.row;
    r.assignments += 1;
    r.hours += hours;
    agg.weighted += rate * hours;
    r.observedMin = Math.min(r.observedMin, rate);
    r.observedMax = Math.max(r.observedMax, rate);

    if (verdict === 'above-max') {
      r.hoursAbove += hours;
      r.excessAmount += variance;
      if (isOpen) r.openExcessAmount += variance;
    } else if (verdict === 'below-min') {
      r.hoursBelow += hours;
      r.shortfallAmount += variance;
    } else {
      r.hoursIn += hours;
    }
  }

  const titles = Array.from(byTitle.values()).map(({ row, weighted }) => {
    row.weightedRate = row.hours > 0 ? weighted / row.hours : 0;

    // The case the per-assignment classification exists to catch: hours on
    // both sides of the band, or hours outside it while the average sits in.
    const bothSides = row.hoursAbove > 0 && row.hoursBelow > 0;
    const averageLooksFine =
      row.weightedRate >= row.cardMinRate &&
      row.weightedRate <= row.cardMaxRate &&
      row.hoursAbove + row.hoursBelow > 0;
    row.scattered = bothSides || averageLooksFine;
    return row;
  });

  // Most money first. The percentage is the headline; the money is the action.
  titles.sort(
    (a, b) =>
      b.excessAmount - a.excessAmount ||
      b.hoursAbove - a.hoursAbove ||
      a.cardTitle.localeCompare(b.cardTitle)
  );

  const totals = titles.reduce<ComplianceTotals>(
    (acc, t) => ({
      hours: acc.hours + t.hours,
      hoursBelow: acc.hoursBelow + t.hoursBelow,
      hoursIn: acc.hoursIn + t.hoursIn,
      hoursAbove: acc.hoursAbove + t.hoursAbove,
      inBandShare: null,
      excessAmount: acc.excessAmount + t.excessAmount,
      shortfallAmount: acc.shortfallAmount + t.shortfallAmount,
      openExcessAmount: acc.openExcessAmount + t.openExcessAmount,
      assignments: acc.assignments + t.assignments,
      titlesScattered: acc.titlesScattered + (t.scattered ? 1 : 0),
    }),
    {
      hours: 0, hoursBelow: 0, hoursIn: 0, hoursAbove: 0, inBandShare: null,
      excessAmount: 0, shortfallAmount: 0, openExcessAmount: 0,
      assignments: 0, titlesScattered: 0,
    }
  );
  totals.inBandShare = totals.hours > 0 ? totals.hoursIn / totals.hours : null;

  const worstAssignments = assignments
    .filter((a) => a.verdict === 'above-max')
    .sort((a, b) => b.varianceAmount - a.varianceAmount)
    .slice(0, 50);

  const currency = singleCurrency(scope);

  return {
    rateYear: scope.rateYear,
    availableYears: scope.availableYears,
    countries: Array.from(scope.countries).sort(),
    currency,
    titles,
    totals,
    worstAssignments,
    unbandedHours,
    unbandedTitles: unbandedTitles.size,
    unresolvedClients: scope.unresolvedClients,
    excluded,
    currencyWarning:
      scope.currencies.size > 1
        ? `The scope spans ${scope.currencies.size} comparison currencies (${Array.from(
            scope.currencies
          )
            .sort()
            .join(', ')}). Totals below add different currencies together and mean nothing — ` +
          'scope to one country.'
        : undefined,
  };
};
