/**
 * String similarity shared by the client and title matchers.
 *
 * Extracted rather than duplicated: both matchers rank candidates the same way
 * and a second copy would drift. The two measures answer different questions
 * and are used together on purpose — token overlap catches reordering and
 * missing words, character bigrams catch typos and spacing.
 */

const bigramsOf = (value: string): string[] => {
  const out: string[] = [];
  for (let i = 0; i < value.length - 1; i += 1) out.push(value.slice(i, i + 2));
  return out;
};

/**
 * Sørensen–Dice similarity over character bigrams, 0 to 1.
 *
 * Catches what token comparison misses — "wal mart" against "walmart",
 * "enginer" against "engineer". Counts multiplicities rather than using sets,
 * so a repeated bigram cannot inflate the score.
 */
export const diceCoefficient = (a: string, b: string): number => {
  if (a === b) return a ? 1 : 0;
  if (a.length < 2 || b.length < 2) return 0;

  const left = bigramsOf(a);
  const right = bigramsOf(b);
  const remaining = new Map<string, number>();
  for (const gram of left) remaining.set(gram, (remaining.get(gram) ?? 0) + 1);

  let hits = 0;
  for (const gram of right) {
    const count = remaining.get(gram) ?? 0;
    if (count > 0) {
      remaining.set(gram, count - 1);
      hits += 1;
    }
  }
  return (2 * hits) / (left.length + right.length);
};

/** Jaccard overlap of two token sets, 0 to 1. */
export const jaccard = (a: Set<string>, b: Set<string>): number => {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
};

export const asPercent = (value: number): string => `${Math.round(value * 100)}%`;
