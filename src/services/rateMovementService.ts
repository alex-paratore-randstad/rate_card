import { RateCardRecord, TitleMapping } from '../types/rateCard';
import { countryKey, OTHER_REGION, REGIONS, regionForCountry } from './countryService';
import { normalizeJobTitle } from './titleService';

/**
 * What moved between two rate years: the change in the card maximum — the
 * not-to-exceed rate — by job family and region.
 *
 * Built from the uploaded cards alone. The change is measured per rate line
 * first and only then averaged, because averaging rates before comparing them
 * measures mix: a region that added a senior title in the later year would
 * show a rise nobody negotiated. A line is one title for one client, country
 * and labor type, present in both years.
 *
 * A percentage is also the only comparison that survives currency. Lines in
 * one region are often priced in several currencies, and a change in each is
 * comparable where their rates are not.
 *
 * Every line counts once. The card carries no volume, so a spend-weighted
 * figure needs the Domo actuals; an unweighted average stated as such is more
 * honest than a weighting the card cannot support.
 */

export type MovementGrouping = 'family' | 'title';

/** Row label for titles the mapping file gives no family. */
export const NO_FAMILY = 'No family in mapping file';

export interface MovementCell {
  /** Mean percent change across the cell's lines, e.g. 4.2 for +4.2%. */
  change: number;
  lines: number;
}

export interface MovementRow {
  label: string;
  /** Keyed by region. A region absent here has no paired lines. */
  cells: Map<string, MovementCell>;
  overall: MovementCell;
}

export interface RateMovement {
  fromYear: string;
  toYear: string;
  grouping: MovementGrouping;
  /** Regions with at least one paired line, in display order. */
  regions: string[];
  rows: MovementRow[];
  /** The column summaries, across every row. */
  regionTotals: Map<string, MovementCell>;
  overall: MovementCell | null;
  /** Lines present in only one of the two years, so not compared. */
  onlyInFrom: number;
  onlyInTo: number;
  /** Lines with no usable maximum in one of the years. */
  unusable: number;
}

interface Accumulator {
  sum: number;
  lines: number;
}

const add = (map: Map<string, Accumulator>, key: string, change: number) => {
  const acc = map.get(key) ?? { sum: 0, lines: 0 };
  acc.sum += change;
  acc.lines += 1;
  map.set(key, acc);
};

const toCell = (acc: Accumulator): MovementCell => ({ change: acc.sum / acc.lines, lines: acc.lines });

const lineKey = (r: RateCardRecord) =>
  [r.client || '', countryKey(r.country || ''), normalizeJobTitle(r.jobTitle), r.laborType || ''].join(
    '||'
  );

/**
 * The maximum for each line in one year. A line repeated within a year — the
 * same title twice on one tab — is averaged rather than taking whichever row
 * came first.
 */
const maxByLine = (records: RateCardRecord[]) => {
  const sums = new Map<string, { record: RateCardRecord; sum: number; count: number }>();
  for (const r of records) {
    const key = lineKey(r);
    const entry = sums.get(key) ?? { record: r, sum: 0, count: 0 };
    entry.sum += r.maxRate;
    entry.count += 1;
    sums.set(key, entry);
  }
  return new Map(
    Array.from(sums, ([key, { record, sum, count }]) => [key, { record, max: sum / count }])
  );
};

/** True when the mapping file carries a family for at least one title. */
export const mappingsHaveFamilies = (mappings: TitleMapping[]): boolean =>
  mappings.some((m) => !!m.family);

export const computeRateMovement = (
  records: RateCardRecord[],
  fromYear: string,
  toYear: string,
  mappings: TitleMapping[],
  grouping: MovementGrouping
): RateMovement => {
  const byKey = new Map(mappings.map((m) => [m.uploadedTitleKey, m]));
  const rowLabel = (title: string): string => {
    const mapping = byKey.get(normalizeJobTitle(title));
    if (grouping === 'family') return mapping?.family || NO_FAMILY;
    return mapping?.standardTitle || title;
  };

  const from = maxByLine(records.filter((r) => r.rateYear === fromYear));
  const to = maxByLine(records.filter((r) => r.rateYear === toYear));

  const cellAcc = new Map<string, Map<string, Accumulator>>();
  const rowAcc = new Map<string, Accumulator>();
  const regionAcc = new Map<string, Accumulator>();
  const overallAcc: Accumulator = { sum: 0, lines: 0 };
  let onlyInFrom = 0;
  let unusable = 0;

  for (const [key, before] of from) {
    const after = to.get(key);
    if (!after) {
      onlyInFrom += 1;
      continue;
    }
    if (!(before.max > 0) || !(after.max > 0)) {
      unusable += 1;
      continue;
    }
    const change = (after.max / before.max - 1) * 100;
    const label = rowLabel(after.record.jobTitle);
    const region = regionForCountry(after.record.country || '');

    const cells = cellAcc.get(label) ?? new Map<string, Accumulator>();
    add(cells, region, change);
    cellAcc.set(label, cells);
    add(rowAcc, label, change);
    add(regionAcc, region, change);
    overallAcc.sum += change;
    overallAcc.lines += 1;
  }

  const onlyInTo = Array.from(to.keys()).filter((key) => !from.has(key)).length;

  const order = [...REGIONS, OTHER_REGION] as string[];
  const regions = order.filter((r) => regionAcc.has(r));

  // Largest rise first, which is the order the deck reads them in. The rows
  // without a family go last whatever they hold: they are a gap in the mapping
  // file, not a finding.
  const rows: MovementRow[] = Array.from(cellAcc, ([label, cells]) => ({
    label,
    cells: new Map(Array.from(cells, ([region, acc]) => [region, toCell(acc)])),
    overall: toCell(rowAcc.get(label)!),
  })).sort(
    (a, b) =>
      Number(a.label === NO_FAMILY) - Number(b.label === NO_FAMILY) ||
      b.overall.change - a.overall.change
  );

  return {
    fromYear,
    toYear,
    grouping,
    regions,
    rows,
    regionTotals: new Map(Array.from(regionAcc, ([region, acc]) => [region, toCell(acc)])),
    overall: overallAcc.lines ? toCell(overallAcc) : null,
    onlyInFrom,
    onlyInTo,
    unusable,
  };
};

/**
 * A one-line reading of the grid: what rose most and what moved least, with
 * the regional range when the top row is measured in more than one region.
 */
export const summarizeMovement = (movement: RateMovement, fmt: (v: number) => string): string | null => {
  const rows = movement.rows.filter((r) => r.label !== NO_FAMILY);
  if (rows.length === 0) return null;
  const top = rows[0];
  const bottom = rows[rows.length - 1];

  const changes = Array.from(top.cells.values()).map((c) => c.change);
  const lead =
    changes.length > 1
      ? `${top.label} rises ${fmt(Math.min(...changes))} to ${fmt(Math.max(...changes))} across ${
          changes.length
        } regions`
      : `${top.label} moves most, ${fmt(top.overall.change)}`;

  if (rows.length === 1) return lead;
  return `${lead}; ${bottom.label} moves least, ${fmt(bottom.overall.change)} overall`;
};
