import { AssignmentActualRow, payRateFieldFor } from '../types/domoDatasets';
import {
  RateCardRecord,
  TitleAlias,
  TitleCandidate,
  TitleMatchSuggestion,
  TitleResolution,
  TitleResolutionState,
} from '../types/rateCard';
import { clientCodeFor } from './clientMatchService';
import { ClientAlias } from '../types/rateCard';
import { countryKey } from './countryService';
import { asPercent, diceCoefficient, jaccard } from './stringSimilarity';
import { normalizeJobTitle } from './titleService';

/**
 * Matching a card's job titles onto the titles the actuals use.
 *
 * The same shape of problem as client matching, but the scale changes the
 * design. A client list is resolved once by hand; a title list runs to
 * hundreds per client, so two things matter more than scoring finesse: the
 * queue is ordered by the hours a row would bring into coverage, and the
 * unambiguous matches clear in bulk.
 *
 * There are also signals a client name does not have. Two titles carrying the
 * same occupational code are more likely the same role than their spelling
 * alone suggests, and a candidate whose actual pay sits nowhere near the card
 * band is evidence against the match however well the words line up.
 */

/** At or above this, an unambiguous match resolves without asking. */
export const AUTO_RESOLVE_SCORE = 0.97;

/** Below this a candidate is not worth showing. */
export const SUGGEST_FLOOR = 0.42;

/** Top two candidates closer than this are too close to call. */
export const AMBIGUOUS_MARGIN = 0.04;

/** Sharing an occupational code lifts a weak string match into view. */
export const TAXONOMY_BONUS = 0.12;

/** Pay that lands nowhere near the card band pulls a match back down. */
export const BAND_MISMATCH_PENALTY = 0.1;

/**
 * How far outside the card band a candidate's pay may sit before it counts
 * against the match. A band is a range, not a hard boundary, and actuals
 * routinely sit a little outside one — so the tolerance is generous and only
 * a real disagreement registers.
 */
export const BAND_TOLERANCE = 0.35;

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

/**
 * Aggregate the loaded actuals into one candidate per title, per client.
 *
 * Built from the assignment rows the coverage report already holds rather than
 * from `rate_card_title_directory`. Two reasons: the figures then cannot
 * disagree with the report this exists to improve, and it needs no second
 * dataset mapping — the title directory dataflow has not run.
 *
 * Scoped to one rate year for the same reason the report is: a title's pay in
 * 2025 says nothing useful about a 2026 band.
 */
export const buildTitleCandidates = (
  actuals: AssignmentActualRow[],
  scope: {
    clientCodes: Set<string>;
    countries: Set<string>;
    rateYear: string;
    /**
     * The currency the card is priced in. Candidate rates are reported in it
     * using the source's own conversion, so the band signal compares like with
     * like — a CAD rate against a USD band would otherwise read as a mismatch
     * on every row.
     */
     comparisonCurrency?: string | null;
  }
): TitleCandidate[] => {
  const rateField = scope.comparisonCurrency
    ? payRateFieldFor(scope.comparisonCurrency)
    : null;
  interface Agg {
    candidate: TitleCandidate;
    assignments: Set<string>;
    payDollars: number;
    /** Vote counts, so the code shown is the one most of the hours agree on. */
    soc: Map<string, number>;
    onet: Map<string, number>;
    ms: Map<string, number>;
  }
  const byKey = new Map<string, Agg>();

  const vote = (map: Map<string, number>, value: string | undefined, weight: number) => {
    const v = (value || '').trim();
    if (v) map.set(v, (map.get(v) ?? 0) + weight);
  };

  for (const row of actuals) {
    const code = (row.rsr_client_code || '').trim();
    if (!scope.clientCodes.has(code)) continue;
    if (scope.countries.size && !scope.countries.has(countryKey(row.rsr_country || ''))) continue;
    if (scope.rateYear && (row.card_year || '') !== scope.rateYear) continue;

    const titleKey = normalizeJobTitle(row.title_cleaned || '');
    if (!titleKey) continue;

    const hours = typeof row.hours_to_date === 'number' ? row.hours_to_date : 0;
    if (hours <= 0) continue;

    const key = `${code}||${titleKey}`;
    let agg = byKey.get(key);
    if (!agg) {
      agg = {
        candidate: {
          titleKey,
          title: row.title_cleaned,
          clientCode: code,
          assignments: 0,
          hours: 0,
          currencies: [],
        },
        assignments: new Set(),
        payDollars: 0,
        soc: new Map(),
        onet: new Map(),
        ms: new Map(),
      };
      byKey.set(key, agg);
    }

    // The rate to compare in: the card's currency where the source carries a
    // conversion, otherwise the raw local rate. Resolved before any
    // aggregation so every measure below is in one currency.
    const converted = rateField ? (row[rateField] as number | null) : null;
    const rate =
      typeof converted === 'number'
        ? converted
        : typeof row.pay_rate_st_hr === 'number'
        ? row.pay_rate_st_hr
        : undefined;

    agg.assignments.add(row.assignment_unique_key);
    agg.candidate.hours += hours;
    // Recomputed from the comparison rate rather than the ETL's pay_dollars,
    // which is rate x hours in the local currency.
    agg.payDollars += (rate ?? 0) * hours;

    if (rate !== undefined) {
      agg.candidate.minPayRate =
        agg.candidate.minPayRate === undefined ? rate : Math.min(agg.candidate.minPayRate, rate);
      agg.candidate.maxPayRate =
        agg.candidate.maxPayRate === undefined ? rate : Math.max(agg.candidate.maxPayRate, rate);
    }

    vote(agg.soc, row.soc_broad_group, hours);
    vote(agg.onet, row.onet_detailed_occupation, hours);
    vote(agg.ms, row.ms_category_1, hours);
    const reported =
      typeof converted === 'number' ? scope.comparisonCurrency! : row.currency;
    if (reported && !agg.candidate.currencies.includes(reported)) {
      agg.candidate.currencies.push(reported);
    }
  }

  const top = (map: Map<string, number>): string | undefined =>
    map.size ? Array.from(map).sort((a, b) => b[1] - a[1])[0][0] : undefined;

  return Array.from(byKey.values()).map((agg) => ({
    ...agg.candidate,
    assignments: agg.assignments.size,
    weightedPayRate: agg.candidate.hours > 0 ? agg.payDollars / agg.candidate.hours : undefined,
    socBroadGroup: top(agg.soc),
    onetOccupation: top(agg.onet),
    msCategory: top(agg.ms),
    currencies: agg.candidate.currencies.sort(),
  }));
};

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** Whether a candidate's observed pay overlaps the card band, within tolerance. */
const bandOverlap = (
  card: { min: number; max: number },
  candidate: TitleCandidate
): boolean | undefined => {
  const rate = candidate.weightedPayRate ?? candidate.minPayRate;
  if (rate === undefined || !(card.min > 0 || card.max > 0)) return undefined;

  const width = Math.max(card.max - card.min, card.max * 0.1, 1);
  return rate >= card.min - width * BAND_TOLERANCE && rate <= card.max + width * BAND_TOLERANCE;
};

/**
 * Score one card title against one candidate, with the basis for the score.
 *
 * String similarity leads, then the occupational code and the pay band adjust
 * it. Both adjustments are bounded so neither can carry a match on its own: a
 * shared SOC group covers hundreds of distinct titles, and a coincidentally
 * similar rate says nothing by itself.
 */
export const scoreTitleMatch = (
  cardTitle: string,
  cardBand: { min: number; max: number; laborType?: string },
  candidate: TitleCandidate
): TitleMatchSuggestion => {
  const cardKey = normalizeJobTitle(cardTitle);
  const overlaps = bandOverlap(cardBand, candidate);

  if (!cardKey || !candidate.titleKey) {
    return { candidate, score: 0, reason: 'nothing left to compare', bandOverlaps: overlaps };
  }

  if (cardKey === candidate.titleKey) {
    return {
      candidate,
      score: 1,
      reason:
        cardTitle.trim().toLowerCase() === candidate.title.trim().toLowerCase()
          ? 'identical title'
          : 'same title once abbreviations and levels are normalised',
      bandOverlaps: overlaps,
    };
  }

  const cardTokens = new Set(cardKey.split(' '));
  const candTokens = new Set(candidate.titleKey.split(' '));

  const tokenScore = jaccard(cardTokens, candTokens);
  const charScore = diceCoefficient(cardKey.replace(/ /g, ''), candidate.titleKey.replace(/ /g, ''));
  let score = 0.5 * tokenScore + 0.5 * charScore;
  const reasons: string[] = [`${asPercent(tokenScore)} of words, ${asPercent(charScore)} of characters`];

  // Every word of the shorter title appearing in the longer is stronger
  // evidence than the raw overlap implies — "Software Engineer" inside "Senior
  // Software Engineer" is a level difference, not a different role.
  const shorter = cardTokens.size <= candTokens.size ? cardTokens : candTokens;
  const longer = shorter === cardTokens ? candTokens : cardTokens;
  if (Array.from(shorter).every((t) => longer.has(t))) {
    score = Math.max(score, 0.78 + 0.12 * (shorter.size / longer.size));
    const extra = Array.from(longer).filter((t) => !shorter.has(t));
    reasons.unshift(`every word matches, plus ${extra.map((t) => `"${t}"`).join(', ')}`);
  }

  return {
    candidate,
    score: Math.max(0, Math.min(0.96, score)),
    reason: reasons.join('; '),
    bandOverlaps: overlaps,
  };
};

/**
 * Apply the taxonomy and band adjustments.
 *
 * Separated from the string score so the reason text can say which signal moved
 * a candidate, and so a caller comparing raw spelling can skip them.
 */
const adjust = (
  suggestion: TitleMatchSuggestion,
  cardSoc: Set<string>
): TitleMatchSuggestion => {
  let { score } = suggestion;
  const notes: string[] = [];

  const soc = suggestion.candidate.socBroadGroup;
  if (score < 1 && soc && cardSoc.has(soc)) {
    score = Math.min(0.96, score + TAXONOMY_BONUS);
    notes.push('same occupational group as a title already matched');
  }

  if (suggestion.bandOverlaps === false && score < 1) {
    score = Math.max(0, score - BAND_MISMATCH_PENALTY);
    notes.push('actual pay sits outside the card band');
  } else if (suggestion.bandOverlaps === true) {
    notes.push('actual pay falls in the card band');
  }

  return {
    ...suggestion,
    score,
    reason: notes.length ? `${suggestion.reason}; ${notes.join('; ')}` : suggestion.reason,
  };
};

/** Ranked candidates for one card title, best first. */
export const suggestTitleMatches = (
  cardTitle: string,
  cardBand: { min: number; max: number; laborType?: string },
  candidates: TitleCandidate[],
  cardSoc: Set<string> = new Set(),
  limit = 5
): TitleMatchSuggestion[] =>
  candidates
    .map((c) => adjust(scoreTitleMatch(cardTitle, cardBand, c), cardSoc))
    .filter((s) => s.score >= SUGGEST_FLOOR)
    .sort((a, b) => b.score - a.score || b.candidate.hours - a.candidate.hours)
    .slice(0, limit);

export const isAmbiguous = (suggestions: TitleMatchSuggestion[]): boolean =>
  suggestions.length > 1 && suggestions[0].score - suggestions[1].score < AMBIGUOUS_MARGIN;

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

/**
 * Build the review queue: one row per card title, ordered by the hours
 * resolving it would bring into coverage.
 *
 * Ordering by hours rather than alphabetically is the difference between a
 * usable screen and an unusable one. With hundreds of titles nobody works
 * through the whole list, so the first screenful has to be the part that
 * matters — and a title with twenty thousand hours behind it matters more than
 * one with forty, whatever its name.
 */
export const resolveTitles = (
  cards: RateCardRecord[],
  candidates: TitleCandidate[],
  clientAliases: ClientAlias[],
  titleAliases: TitleAlias[],
  rateYear: string
): TitleResolution[] => {
  const aliasByKey = new Map(titleAliases.map((a) => [`${a.clientCode}||${a.cardTitleKey}`, a]));
  const candidatesByClient = new Map<string, TitleCandidate[]>();
  for (const c of candidates) {
    const list = candidatesByClient.get(c.clientCode) ?? [];
    list.push(c);
    candidatesByClient.set(c.clientCode, list);
  }

  // Occupational codes already tied to this client's matched titles, so an
  // accepted match makes its peers easier to find.
  const socByClient = new Map<string, Set<string>>();
  for (const alias of titleAliases) {
    if (alias.method === 'none') continue;
    const match = candidates.find(
      (c) => c.clientCode === alias.clientCode && c.titleKey === alias.actualTitleKey
    );
    if (match?.socBroadGroup) {
      const set = socByClient.get(alias.clientCode) ?? new Set<string>();
      set.add(match.socBroadGroup);
      socByClient.set(alias.clientCode, set);
    }
  }

  // One row per card title per client; several card rows for a title widen the
  // band rather than producing duplicate queue entries.
  const byKey = new Map<string, TitleResolution>();

  for (const card of cards) {
    if (card.rateYear !== rateYear) continue;
    const clientName = (card.client || '').trim();
    const clientCode = clientCodeFor(clientName, clientAliases);
    if (!clientCode) continue;

    const cardTitleKey = normalizeJobTitle(card.jobTitle || '');
    if (!cardTitleKey) continue;

    const key = `${clientCode}||${cardTitleKey}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.cardMinRate = Math.min(existing.cardMinRate, card.minRate);
      existing.cardMaxRate = Math.max(existing.cardMaxRate, card.maxRate);
      continue;
    }

    byKey.set(key, {
      clientCode,
      clientLabel: clientName,
      cardTitle: card.jobTitle,
      cardTitleKey,
      cardMinRate: card.minRate,
      cardMaxRate: card.maxRate,
      hoursAtStake: 0,
      state: 'pending',
      suggestions: [],
    });
  }

  const resolutions: TitleResolution[] = [];

  for (const [key, row] of byKey) {
    const alias = aliasByKey.get(key);
    const pool = candidatesByClient.get(row.clientCode) ?? [];

    if (alias) {
      const matched = pool.find((c) => c.titleKey === alias.actualTitleKey);
      resolutions.push({
        ...row,
        state: 'resolved',
        alias,
        hoursAtStake: matched?.hours ?? 0,
        suggestions: [],
      });
      continue;
    }

    if (!pool.length) {
      resolutions.push({ ...row, state: 'pending' });
      continue;
    }

    const suggestions = suggestTitleMatches(
      row.cardTitle,
      { min: row.cardMinRate, max: row.cardMaxRate, laborType: undefined },
      pool,
      socByClient.get(row.clientCode) ?? new Set()
    );

    let state: TitleResolutionState;
    if (!suggestions.length) state = 'unmatched';
    else if (isAmbiguous(suggestions)) state = 'ambiguous';
    else state = 'suggested';

    resolutions.push({
      ...row,
      state,
      suggestions,
      hoursAtStake: suggestions[0]?.candidate.hours ?? 0,
    });
  }

  return resolutions.sort(
    (a, b) => b.hoursAtStake - a.hoursAtStake || a.cardTitle.localeCompare(b.cardTitle)
  );
};

/** Matches strong and clear enough to accept without asking. */
export const autoResolvableTitles = (
  resolutions: TitleResolution[]
): { resolution: TitleResolution; suggestion: TitleMatchSuggestion }[] =>
  resolutions
    .filter(
      (r) =>
        r.state === 'suggested' &&
        r.suggestions[0]?.score >= AUTO_RESOLVE_SCORE &&
        !isAmbiguous(r.suggestions)
    )
    .map((r) => ({ resolution: r, suggestion: r.suggestions[0] }));

/**
 * The actuals title a card title resolves to, or null when unresolved.
 *
 * Null means "cannot be joined" and callers must not fall back to comparing
 * the raw strings — that is the behaviour the matcher replaces.
 */
export const actualTitleKeyFor = (
  clientCode: string,
  cardTitle: string,
  aliases: TitleAlias[]
): string | null => {
  const key = normalizeJobTitle(cardTitle);
  const alias = aliases.find((a) => a.clientCode === clientCode && a.cardTitleKey === key);
  return alias && alias.method !== 'none' && alias.actualTitleKey ? alias.actualTitleKey : null;
};
