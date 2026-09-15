import { RateCardRecord } from '../types/rateCard';

/**
 * Sanity checks on an uploaded rate card, run against the card alone.
 *
 * These exist because of a specific failure. A card was loaded whose max was
 * every title's min multiplied by 11/9 — a fixed 22.2% uplift, almost
 * certainly a formula cell in the spreadsheet. Nothing was wrong with the
 * ingestion, and nothing looked wrong in the reports: the compliance report
 * dutifully measured hours against that max and produced a five-figure
 * "cost above band" that was not a ceiling anyone had agreed to.
 *
 * It took reading three reports and noticing the ratio by hand to find. The
 * point of these checks is that the card says so at upload, before a number
 * built on it is quoted to anybody.
 */

export type CardIssueKind =
  | 'formula-derived-band'
  | 'inverted-band'
  | 'zero-width-band'
  | 'missing-rate'
  | 'implausible-width';

export interface CardIssue {
  kind: CardIssueKind;
  severity: 'high' | 'medium';
  /** What was found. */
  summary: string;
  /** Why it changes how the reports should be read. */
  consequence: string;
  /** What to do about it. */
  action: string;
  /** Titles affected, capped for display. */
  titles: string[];
  count: number;
  /** Rows checked for this issue, for the share it represents. */
  outOf: number;
}

/**
 * At least this share of rows must share one ratio before it is called a
 * formula. Real market bands vary title by title, so a dominant ratio is only
 * meaningful when it dominates — a couple of coincidences prove nothing.
 */
export const FORMULA_SHARE = 0.8;

/** And this many rows, so three titles cannot look like a pattern. */
export const FORMULA_MIN_ROWS = 4;

/**
 * How far a ratio may sit from the median and still count as the same ratio.
 *
 * A tolerance rather than a fixed rounding, because the source rounds rates to
 * the cent: a formula-derived max of min x 11/9 lands on 20.93 for a 17.13 min
 * and 19.56 for 16.00, whose ratios differ in the fourth decimal place.
 * Bucketing those by three decimals split one formula across two buckets and
 * let it through — which is how this check missed the very card it was written
 * for. Genuine market bands differ by whole percent, far outside this.
 */
export const RATIO_TOLERANCE = 0.005;

/** Above this, a band is too wide to govern anything. */
export const IMPLAUSIBLE_RATIO = 3;

/**
 * Name a ratio as a simple fraction when it is one.
 *
 * "exactly 11/9" is a far more convincing account of a formula than "1.2222",
 * and it is the form someone can go and look for in the spreadsheet.
 */
export const asSimpleFraction = (ratio: number): string | null => {
  for (let q = 2; q <= 24; q += 1) {
    const p = Math.round(ratio * q);
    if (p <= q) continue;
    if (Math.abs(ratio - p / q) < 0.0006) {
      // Reduce, so 22/18 is reported as 11/9.
      const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
      const g = gcd(p, q);
      return `${p / g}/${q / g}`;
    }
  }
  return null;
};

/** Audit a set of rate card records. Empty result means nothing to report. */
export const auditCardBands = (records: RateCardRecord[]): CardIssue[] => {
  if (!records.length) return [];

  const issues: CardIssue[] = [];
  const cap = (titles: string[]) => Array.from(new Set(titles)).slice(0, 8);

  // --- structural problems, per row --------------------------------------
  const missing = records.filter((r) => !(r.minRate > 0) || !(r.maxRate > 0));
  const usable = records.filter((r) => r.minRate > 0 && r.maxRate > 0);
  const inverted = usable.filter((r) => r.minRate > r.maxRate);
  const zeroWidth = usable.filter((r) => r.minRate === r.maxRate);
  const tooWide = usable.filter((r) => r.maxRate / r.minRate > IMPLAUSIBLE_RATIO);

  if (missing.length) {
    issues.push({
      kind: 'missing-rate',
      severity: 'high',
      summary: `${missing.length} title(s) have no usable min or max rate.`,
      consequence:
        'Nothing can be compared against them. They will appear as card rows with no hours, ' +
        'which reads like a coverage gap rather than a missing rate.',
      action: 'Check the mapped min and max columns, and whether those rows are blank in the file.',
      titles: cap(missing.map((r) => r.jobTitle)),
      count: missing.length,
      outOf: records.length,
    });
  }

  if (inverted.length) {
    issues.push({
      kind: 'inverted-band',
      severity: 'high',
      summary: `${inverted.length} title(s) have a minimum above their maximum.`,
      consequence:
        'Every assignment is both above the max and below the min, so the compliance verdict ' +
        'is meaningless for these titles.',
      action: 'The min and max columns are probably mapped the wrong way round.',
      titles: cap(inverted.map((r) => r.jobTitle)),
      count: inverted.length,
      outOf: usable.length,
    });
  }

  if (zeroWidth.length) {
    issues.push({
      kind: 'zero-width-band',
      severity: 'medium',
      summary: `${zeroWidth.length} title(s) have a min equal to their max.`,
      consequence:
        'A band with no width admits one exact rate, so anything other than that rate to the ' +
        'cent counts as a breach.',
      action: 'Confirm these are single agreed rates rather than a missing second column.',
      titles: cap(zeroWidth.map((r) => r.jobTitle)),
      count: zeroWidth.length,
      outOf: usable.length,
    });
  }

  if (tooWide.length) {
    issues.push({
      kind: 'implausible-width',
      severity: 'medium',
      summary: `${tooWide.length} title(s) have a max more than ${IMPLAUSIBLE_RATIO}x their min.`,
      consequence:
        'A band that wide will report almost everything as compliant, which is not the same as ' +
        'the rates being right.',
      action: 'Check whether one end is a different measure — a bill rate against a pay rate, say.',
      titles: cap(tooWide.map((r) => r.jobTitle)),
      count: tooWide.length,
      outOf: usable.length,
    });
  }

  // --- the formula check, across rows ------------------------------------
  const comparable = usable.filter((r) => r.minRate !== r.maxRate);
  if (comparable.length >= FORMULA_MIN_ROWS) {
    const withRatio = comparable
      .map((r) => ({ ratio: r.maxRate / r.minRate, title: r.jobTitle }))
      .sort((a, b) => a.ratio - b.ratio);

    // The median is the reference rather than the mean: a couple of genuine
    // outliers in an otherwise formulaic card should not drag it off the
    // formula and hide it.
    const mid = Math.floor(withRatio.length / 2);
    const median =
      withRatio.length % 2 === 0
        ? (withRatio[mid - 1].ratio + withRatio[mid].ratio) / 2
        : withRatio[mid].ratio;

    const onFormula = withRatio.filter(
      (r) => Math.abs(r.ratio - median) / median <= RATIO_TOLERANCE
    );
    const share = onFormula.length / withRatio.length;

    if (share >= FORMULA_SHARE) {
      const uplift = ((median - 1) * 100).toFixed(1);
      const fraction = asSimpleFraction(median);
      const dominant = { titles: onFormula.map((r) => r.title) };
      issues.push({
        kind: 'formula-derived-band',
        severity: 'high',
        summary:
          `${dominant.titles.length} of ${withRatio.length} titles have a max exactly ` +
          `${uplift}% above their min${fraction ? ` — a ratio of ${fraction}` : ''}.`,
        consequence:
          'A band whose width is the same on every title is not a market range; the max is ' +
          'derived from the min. "Above band" then means "more than ' +
          `${uplift}% above the minimum", which is an arbitrary threshold rather than a ceiling ` +
          'anyone agreed to — and any cost-above-band figure is not recoverable money.',
        action:
          'Check whether the max column in the source is a formula. If it is, treat the min as ' +
          'the rate and the compliance verdict as directional only, or source a real maximum.',
        titles: cap(dominant.titles),
        count: dominant.titles.length,
        outOf: withRatio.length,
      });
    }
  }

  // Highest severity first, then by how much of the card is affected.
  return issues.sort(
    (a, b) =>
      (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1) ||
      b.count / b.outOf - a.count / a.outOf
  );
};
