import { RateCardRecord } from '../types/rateCard';

/**
 * Sanity checks on an uploaded rate card, run against the card alone, so a
 * band that cannot govern anything is flagged at upload — before a number
 * built on it is quoted to anybody.
 *
 * There is deliberately no check for a max derived from the min by a fixed
 * ratio. Suggested bill rate cards are built that way on purpose (min plus a
 * set spread), so the band is still the agreed ceiling.
 */

export type CardIssueKind =
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

/** Above this, a band is too wide to govern anything. */
export const IMPLAUSIBLE_RATIO = 3;

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

  // Highest severity first, then by how much of the card is affected.
  return issues.sort(
    (a, b) =>
      (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1) ||
      b.count / b.outOf - a.count / a.outOf
  );
};
