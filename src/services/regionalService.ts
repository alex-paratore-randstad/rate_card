import { AssignmentActualRow } from '../types/domoDatasets';
import { ClientAlias, RateCardRecord, TitleAlias } from '../types/rateCard';
import { resolveScope, scopeRows, singleCurrency } from './scopeService';

/**
 * Whether a national band describes the market, or the market is regional.
 *
 * The card headers say "National Average". This measures whether that holds:
 * for each matched title, the hours-weighted rate in each geography against
 * the median region for that same title.
 *
 * The method matters more than usual here, and two versions of it were wrong
 * before this one.
 *
 * Comparing the average rate paid in a region against the average paid
 * nationally measures **job mix**, not geography — a region staffing more
 * senior roles looks expensive wherever it is. On a test set where one state
 * held the senior work and another the junior, that method reported the first
 * as 108% more expensive when the real geographic difference was 10%. So every
 * differential is computed *within* a title.
 *
 * Measuring against the title's hours-weighted overall rate then leaves two
 * smaller versions of the same problem: the region holding most of the hours
 * largely defines the baseline it is judged against, and a thin cell moves
 * that baseline even while being excluded from the index it feeds. The
 * baseline is therefore the median across regions that clear the volume bar.
 *
 * The second guard is volume. A region with one assignment has a rate, not a
 * market rate, and presenting its differential as a finding would be worse
 * than omitting it. Cells below the thresholds are counted and shown, but
 * never fed into an index or a suggested band.
 */

export type GeographyLevel = 'state_province' | 'city' | 'market' | 'rsr_region';

export const GEOGRAPHY_LABELS: Record<GeographyLevel, string> = {
  state_province: 'State / province',
  city: 'City',
  market: 'Market',
  rsr_region: 'Region',
};

/**
 * Volume a title-in-a-region needs before its differential is treated as
 * measurement rather than anecdote. Two assignments because one is a single
 * negotiation; 400 hours because a rate held for ten weeks is a rate, and one
 * held for an afternoon is not.
 */
export const MIN_ASSIGNMENTS = 2;
export const MIN_HOURS = 400;

/**
 * Spread across regions beyond which regional tiers would change something.
 * Below this the national band already covers the variation.
 */
export const MATERIAL_SPREAD = 0.1;

export interface RegionCell {
  region: string;
  assignments: number;
  hours: number;
  weightedRate: number;
  /** The region's rate over the title's rate overall. 1.12 is 12% above. */
  differential: number;
  /** Meets the volume thresholds, and so may inform an index or a band. */
  reliable: boolean;
}

export interface TitleRegionRow {
  cardTitle: string;
  actualTitle: string;
  clientCode: string;
  clientLabel: string;
  currency: string;
  cardMinRate: number;
  cardMaxRate: number;
  /** Hours-weighted across every region. Context, not the comparison basis. */
  overallRate: number;
  /**
   * What each region's differential is measured against: the median rate among
   * regions with enough volume.
   *
   * Not the hours-weighted overall rate, for two reasons found in testing. A
   * region holding most of the hours would otherwise define the baseline it is
   * then measured against, reporting itself as average however far it sits
   * from everywhere else. And a thin cell — one assignment at an odd rate —
   * still moved that baseline even while being excluded from the index it
   * fed. The median across reliable regions is immune to both.
   */
  referenceRate: number;
  hours: number;
  assignments: number;
  cells: RegionCell[];
  reliableCells: number;
  /** Highest differential over lowest, among reliable cells. Null if under two. */
  spread: number | null;
  /** The spread is large enough that a single national band misprices someone. */
  tiersWouldMatter: boolean;
}

export interface RegionIndexRow {
  region: string;
  /** Matched titles with enough volume here to contribute. */
  titles: number;
  assignments: number;
  hours: number;
  /**
   * Hours-weighted mean of this region's within-title differentials.
   *
   * This is the number a regional card tier would use: multiply the national
   * band by it. Built from within-title comparisons so it measures the region
   * and not the roles the region happens to staff.
   */
  index: number;
  /** Contributed to by at least two titles, so not one title's story. */
  reliable: boolean;
}

export interface RegionalReport {
  level: GeographyLevel;
  rateYear: string;
  availableYears: string[];
  countries: string[];
  currency: string | null;
  titles: TitleRegionRow[];
  regionIndex: RegionIndexRow[];
  totals: {
    titlesAnalysed: number;
    titlesWithMaterialSpread: number;
    regionsMeasured: number;
    hoursAnalysed: number;
    /** Title-region cells set aside for thin volume. */
    thinCells: number;
    thinHours: number;
  };
  unresolvedClients: string[];
  excluded: { reason: string; count: number }[];
  currencyWarning?: string;
}

const blank = '(not recorded)';

export const buildRegionalReport = (
  cards: RateCardRecord[],
  actuals: AssignmentActualRow[],
  clientAliases: ClientAlias[],
  titleAliases: TitleAlias[] = [],
  options: { level?: GeographyLevel; rateYear?: string } = {}
): RegionalReport => {
  const level = options.level ?? 'state_province';
  const scope = resolveScope(cards, clientAliases, titleAliases, options.rateYear);
  const { scoped, excluded } = scopeRows(actuals, scope);

  interface CellAgg {
    assignments: Set<string>;
    hours: number;
    payDollars: number;
  }
  interface TitleAgg {
    row: TitleRegionRow;
    hours: number;
    payDollars: number;
    cells: Map<string, CellAgg>;
  }

  const byTitle = new Map<string, TitleAgg>();

  for (const item of scoped) {
    // Only titles the card actually prices. An unbanded title has no national
    // band to compare a region against, and belongs to the coverage report.
    if (!item.band) continue;

    const key = `${item.clientCode}||${item.titleKey}`;
    let agg = byTitle.get(key);
    if (!agg) {
      agg = {
        hours: 0,
        payDollars: 0,
        cells: new Map(),
        row: {
          cardTitle: item.band.title,
          actualTitle: item.row.title_cleaned,
          clientCode: item.clientCode,
          clientLabel: item.band.clientLabel,
          currency: item.currency,
          cardMinRate: item.band.minRate,
          cardMaxRate: item.band.maxRate,
          overallRate: 0,
          referenceRate: 0,
          hours: 0,
          assignments: 0,
          cells: [],
          reliableCells: 0,
          spread: null,
          tiersWouldMatter: false,
        },
      };
      byTitle.set(key, agg);
    }

    agg.hours += item.hours;
    agg.payDollars += item.rate * item.hours;

    const region = (item.row[level] as string | undefined)?.trim() || blank;
    let cell = agg.cells.get(region);
    if (!cell) {
      cell = { assignments: new Set(), hours: 0, payDollars: 0 };
      agg.cells.set(region, cell);
    }
    cell.assignments.add(item.row.assignment_unique_key);
    cell.hours += item.hours;
    cell.payDollars += item.rate * item.hours;
  }

  // --- per title ----------------------------------------------------------
  let thinCells = 0;
  let thinHours = 0;

  const titles: TitleRegionRow[] = [];
  for (const agg of byTitle.values()) {
    const overallRate = agg.hours > 0 ? agg.payDollars / agg.hours : 0;
    if (!(overallRate > 0)) continue;

    // Rate each region first, then choose the baseline from the reliable ones
    // only, then measure against it. Order matters: a baseline drawn before the
    // thin cells are excluded carries their noise into every differential.
    const rated = Array.from(agg.cells, ([region, c]) => {
      const weightedRate = c.hours > 0 ? c.payDollars / c.hours : 0;
      const isReliable =
        c.assignments.size >= MIN_ASSIGNMENTS && c.hours >= MIN_HOURS && weightedRate > 0;
      if (!isReliable) {
        thinCells += 1;
        thinHours += c.hours;
      }
      return {
        region,
        assignments: c.assignments.size,
        hours: c.hours,
        weightedRate,
        reliable: isReliable,
      };
    });

    const reliableRates = rated
      .filter((c) => c.reliable)
      .map((c) => c.weightedRate)
      .sort((a, b) => a - b);

    // Median of the reliable regions, falling back to the overall rate when
    // there are none — there is then nothing to compare and every
    // differential is 1, which is the honest answer.
    const referenceRate = reliableRates.length
      ? reliableRates.length % 2 === 0
        ? (reliableRates[reliableRates.length / 2 - 1] + reliableRates[reliableRates.length / 2]) / 2
        : reliableRates[(reliableRates.length - 1) / 2]
      : overallRate;

    const cells: RegionCell[] = rated
      .map((c) => ({
        region: c.region,
        assignments: c.assignments,
        hours: c.hours,
        weightedRate: c.weightedRate,
        differential: referenceRate > 0 ? c.weightedRate / referenceRate : 1,
        reliable: c.reliable,
      }))
      .sort((a, b) => b.hours - a.hours);

    const reliable = cells.filter((c) => c.reliable);
    const spread =
      reliable.length >= 2
        ? Math.max(...reliable.map((c) => c.differential)) /
          Math.min(...reliable.map((c) => c.differential))
        : null;

    const row = agg.row;
    row.overallRate = overallRate;
    row.referenceRate = referenceRate;
    row.hours = agg.hours;
    row.assignments = cells.reduce((s, c) => s + c.assignments, 0);
    row.cells = cells;
    row.reliableCells = reliable.length;
    row.spread = spread;
    row.tiersWouldMatter = spread !== null && spread - 1 >= MATERIAL_SPREAD;
    titles.push(row);
  }

  // Widest spread first — those are the titles a national band misprices.
  titles.sort(
    (a, b) => (b.spread ?? 0) - (a.spread ?? 0) || b.hours - a.hours
  );

  // --- the regional index -------------------------------------------------
  //
  // A weighted mean of within-title differentials, never of raw regional
  // rates. The distinction is the whole method: raw rates would report a
  // region that staffs senior roles as an expensive region.
  interface IndexAgg {
    titles: Set<string>;
    assignments: number;
    hours: number;
    weightedDifferential: number;
  }
  const indexMap = new Map<string, IndexAgg>();

  for (const title of titles) {
    for (const cell of title.cells) {
      if (!cell.reliable) continue;
      let agg = indexMap.get(cell.region);
      if (!agg) {
        agg = { titles: new Set(), assignments: 0, hours: 0, weightedDifferential: 0 };
        indexMap.set(cell.region, agg);
      }
      agg.titles.add(`${title.clientCode}||${title.cardTitle}`);
      agg.assignments += cell.assignments;
      agg.hours += cell.hours;
      agg.weightedDifferential += cell.differential * cell.hours;
    }
  }

  const regionIndex: RegionIndexRow[] = Array.from(indexMap, ([region, agg]) => ({
    region,
    titles: agg.titles.size,
    assignments: agg.assignments,
    hours: agg.hours,
    index: agg.hours > 0 ? agg.weightedDifferential / agg.hours : 1,
    // One title's differential is that title's story, not the region's.
    reliable: agg.titles.size >= 2,
  })).sort((a, b) => b.index - a.index || b.hours - a.hours);

  return {
    level,
    rateYear: scope.rateYear,
    availableYears: scope.availableYears,
    countries: Array.from(scope.countries).sort(),
    currency: singleCurrency(scope),
    titles,
    regionIndex,
    totals: {
      titlesAnalysed: titles.length,
      titlesWithMaterialSpread: titles.filter((t) => t.tiersWouldMatter).length,
      regionsMeasured: regionIndex.filter((r) => r.reliable).length,
      hoursAnalysed: titles.reduce((s, t) => s + t.hours, 0),
      thinCells,
      thinHours,
    },
    unresolvedClients: scope.unresolvedClients,
    excluded,
    currencyWarning:
      scope.currencies.size > 1
        ? `The scope spans ${scope.currencies.size} currencies. A regional comparison across ` +
          'them confounds geography with the exchange rate — scope to one country.'
        : undefined,
  };
};

/** The band a regional tier would carry: the national band times the index. */
export const suggestedBand = (
  title: TitleRegionRow,
  index: number
): { min: number; max: number } => ({
  min: title.cardMinRate * index,
  max: title.cardMaxRate * index,
});
