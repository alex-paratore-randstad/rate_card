import {
  ClientAlias,
  ClientDirectoryEntry,
  ClientMatchSuggestion,
  ClientResolution,
  ClientResolutionState,
} from '../types/rateCard';

/**
 * Matching an uploaded client string onto the client Domo knows.
 *
 * The uploaded card says "Xerox"; Domo says "Xerox Corporation". Rather than
 * match on the name at report time — where a wrong match silently blends two
 * markets — the pairing is resolved once onto `rsr_client_code` and persisted.
 *
 * Everything here is pure. Scoring never decides anything on its own beyond an
 * unambiguous exact match: it ranks candidates and states its reason, and a
 * human accepts or rejects.
 */

/**
 * Legal-entity tokens carrying no identifying signal. "Xerox Corporation" and
 * "Xerox" name the same company, so these are dropped from both sides before
 * comparison.
 *
 * Geographic and descriptive qualifiers ("usa", "global", "holdings") are
 * deliberately NOT here. Stripping them would collapse "Acme Holdings" and
 * "Acme Group" into one, and those can be different accounts. They stay in the
 * token set, where they lower the score and prompt a human to look.
 */
const LEGAL_SUFFIX_TOKENS = new Set([
  'inc', 'incorporated', 'corp', 'corporation', 'co', 'company',
  'ltd', 'limited', 'llc', 'llp', 'lp', 'plc',
  'gmbh', 'ag', 'sa', 'sas', 'sarl', 'nv', 'bv', 'ab', 'as', 'oy', 'oyj',
  'aps', 'spa', 'srl', 'pty', 'pte', 'kk', 'kg', 'mbh',
]);

/** At or above this, an unambiguous match resolves without asking. */
export const AUTO_RESOLVE_SCORE = 0.97;

/** Below this a candidate is not worth showing. */
export const SUGGEST_FLOOR = 0.45;

/** Top two candidates closer than this are too close to call. */
export const AMBIGUOUS_MARGIN = 0.03;

/**
 * A blended word/character score can never outrank a containment match, so the
 * ordering the reviewer sees always reflects the strength of the evidence.
 */
const BLEND_CEILING = 0.78;

/**
 * Comparable form of a client name: lowercased, unaccented, punctuation-free,
 * with legal-entity suffixes removed.
 *
 * Exported because the same key is stored on the alias — a later upload of the
 * same client under different capitalisation must hit the stored decision
 * rather than ask again.
 */
export const normalizeClientName = (raw: string): string => tokenizeClientName(raw).join(' ');

/** The token list behind `normalizeClientName`. */
export const tokenizeClientName = (raw: string): string[] => {
  const cleaned = (raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // combining accents
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  if (!cleaned) return [];

  const tokens = cleaned.split(' ').filter(Boolean);
  const meaningful = tokens.filter(
    (t, i) => !LEGAL_SUFFIX_TOKENS.has(t) && !(i === 0 && t === 'the')
  );

  // A company whose name is nothing but suffix tokens ("The Company") would
  // normalize to the empty string and then match everything. Keep the original.
  return meaningful.length ? meaningful : tokens;
};

const bigramsOf = (value: string): string[] => {
  const out: string[] = [];
  for (let i = 0; i < value.length - 1; i += 1) out.push(value.slice(i, i + 2));
  return out;
};

/**
 * Sørensen–Dice similarity over character bigrams. Catches typos and spacing
 * differences that token comparison misses — "wal mart" against "walmart".
 */
const diceCoefficient = (a: string, b: string): number => {
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

const jaccard = (a: Set<string>, b: Set<string>): number => {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
};

/** Tokens that carry no initial — "and" in "Procter and Gamble" / "P and G". */
const CONNECTOR_TOKENS = new Set(['and', 'of', 'the', 'for']);

const significant = (tokens: string[]): string[] =>
  tokens.filter((t) => !CONNECTOR_TOKENS.has(t));

/**
 * Whether a name was written as an acronym in the source.
 *
 * Case is the signal that matters: "IBM", "P&G" and "AT&T" arrive capitalised,
 * while "Xerox" does not. Without this check a five-letter word was matched
 * against any five-word account name on its initials, which is nonsense.
 *
 * Names of three letters or fewer are allowed through regardless of case, so a
 * lowercase "ibm" still resolves.
 */
const looksLikeAcronym = (raw: string, letters: string): boolean => {
  if (letters.length < 2 || letters.length > 6) return false;
  if (!/^[a-z]+$/.test(letters)) return false;
  if (letters.length <= 3) return true;
  const rawLetters = (raw || '').replace(/[^A-Za-z]/g, '');
  return rawLetters.length > 0 && rawLetters === rawLetters.toUpperCase();
};

/**
 * If one side reads as the other's initials, return the expanded name and how
 * exact the fit was. `partial` covers an acronym that matches only the leading
 * initials — "HP" against "Hewlett Packard Enterprise" — which is worth
 * proposing but is weak evidence, since HP Inc and Hewlett Packard Enterprise
 * are in fact different companies.
 */
const acronymMatch = (
  aRaw: string,
  a: string[],
  bRaw: string,
  b: string[]
): { expanded: string; partial: boolean } | null => {
  const check = (
    shortRaw: string,
    short: string[],
    long: string[]
  ): { expanded: string; partial: boolean } | null => {
    const shortSig = significant(short);
    const longSig = significant(long);

    // The short side must be one word, or a run of single letters ("p g").
    if (!(shortSig.length === 1 || shortSig.every((t) => t.length === 1))) return null;
    if (longSig.length < 2) return null;

    const letters = shortSig.join('');
    if (!looksLikeAcronym(shortRaw, letters)) return null;

    const initials = longSig.map((t) => t[0]).join('');
    if (letters === initials) return { expanded: longSig.join(' '), partial: false };
    if (initials.startsWith(letters) && letters.length >= 2) {
      return { expanded: longSig.join(' '), partial: true };
    }
    return null;
  };

  return check(aRaw, a, b) ?? check(bRaw, b, a);
};

const asPercent = (value: number): string => `${Math.round(value * 100)}%`;

/**
 * Score one uploaded name against one candidate, with the basis for the score.
 *
 * The reason is not decoration — it is what lets a reviewer accept or reject
 * without re-deriving the comparison themselves.
 */
export const scoreClientMatch = (
  uploaded: string,
  candidate: string
): { score: number; reason: string } => {
  const uploadedTokens = tokenizeClientName(uploaded);
  const candidateTokens = tokenizeClientName(candidate);

  if (!uploadedTokens.length || !candidateTokens.length) {
    return { score: 0, reason: 'nothing left to compare after normalization' };
  }

  const uploadedNorm = uploadedTokens.join(' ');
  const candidateNorm = candidateTokens.join(' ');

  if (uploadedNorm === candidateNorm) {
    const ignored = tokenizeClientName(candidate).length !== (candidate.match(/\S+/g) || []).length;
    return {
      score: 1,
      reason: ignored
        ? 'same name once the legal suffix is ignored'
        : 'identical after normalization',
    };
  }

  // Spacing-only differences: "Wal Mart" and "Walmart" are the same account.
  if (uploadedNorm.replace(/ /g, '') === candidateNorm.replace(/ /g, '')) {
    return { score: 0.97, reason: 'same name apart from spacing' };
  }

  // Acronyms: "IBM" against "International Business Machines", "P&G" against
  // "Procter & Gamble". Token and character comparison both score these at
  // zero, and they are common enough in account names to be worth a rule.
  //
  // Scored below a spacing match on purpose. Acronyms genuinely collide — "GM"
  // fits both General Motors and General Mills — so this proposes, never
  // resolves on its own, and two colliding candidates trip the ambiguity check.
  const acronymHit = acronymMatch(uploaded, uploadedTokens, candidate, candidateTokens);
  if (acronymHit) {
    return acronymHit.partial
      ? {
          score: 0.72,
          reason: `initials match the start of "${acronymHit.expanded}" — check this one`,
        }
      : { score: 0.9, reason: `initials match "${acronymHit.expanded}"` };
  }

  const uploadedSet = new Set(uploadedTokens);
  const candidateSet = new Set(candidateTokens);

  const shorter = uploadedTokens.length <= candidateTokens.length ? uploadedSet : candidateSet;
  const longer = shorter === uploadedSet ? candidateSet : uploadedSet;
  const contained = Array.from(shorter).every((token) => longer.has(token));

  if (contained) {
    // Ratio, not a flat score: the more extra words the longer name carries,
    // the weaker the evidence that they name the same thing.
    const ratio = shorter.size / longer.size;
    const extra = Array.from(longer).filter((t) => !shorter.has(t));
    return {
      score: 0.8 + 0.15 * ratio,
      reason: `every word matches, plus ${extra.map((t) => `"${t}"`).join(', ')}`,
    };
  }

  const tokenScore = jaccard(uploadedSet, candidateSet);
  const charScore = diceCoefficient(
    uploadedNorm.replace(/ /g, ''),
    candidateNorm.replace(/ /g, '')
  );
  const blended = Math.min(BLEND_CEILING, 0.45 * tokenScore + 0.55 * charScore);

  return {
    score: blended,
    reason: `${asPercent(tokenScore)} of words and ${asPercent(charScore)} of characters in common`,
  };
};

/** Ranked candidates above the floor, best first. */
export const suggestClientMatches = (
  uploaded: string,
  directory: ClientDirectoryEntry[],
  limit = 5
): ClientMatchSuggestion[] =>
  directory
    .map((entry) => {
      const { score, reason } = scoreClientMatch(uploaded, entry.accountName);
      return { entry, score, reason };
    })
    .filter((s) => s.score >= SUGGEST_FLOOR)
    .sort((a, b) => b.score - a.score || (b.entry.hours ?? 0) - (a.entry.hours ?? 0))
    .slice(0, limit);

/**
 * Whether the top candidate stands clearly apart from the runner-up. Two names
 * that score alike are a question for a human, not a coin toss — including two
 * that both score 1.0, which means Domo holds one name under two client codes.
 */
export const isAmbiguous = (suggestions: ClientMatchSuggestion[]): boolean =>
  suggestions.length > 1 && suggestions[0].score - suggestions[1].score < AMBIGUOUS_MARGIN;

/**
 * Build the review screen's rows: every distinct uploaded client string, its
 * stored decision if there is one, and ranked candidates if there is not.
 */
export const resolveClients = (
  uploadedClients: { client: string; recordCount: number }[],
  directory: ClientDirectoryEntry[],
  aliases: ClientAlias[]
): ClientResolution[] => {
  const byKey = new Map(aliases.map((a) => [a.normalizedKey, a]));

  return uploadedClients
    .map(({ client, recordCount }) => {
      const alias = byKey.get(normalizeClientName(client));
      if (alias) {
        return { uploadedClient: client, recordCount, state: 'resolved' as const, alias, suggestions: [] };
      }

      if (!directory.length) {
        return { uploadedClient: client, recordCount, state: 'pending' as const, suggestions: [] };
      }

      const suggestions = suggestClientMatches(client, directory);
      let state: ClientResolutionState;
      if (!suggestions.length) state = 'unmatched';
      else if (isAmbiguous(suggestions)) state = 'ambiguous';
      else state = 'suggested';

      return { uploadedClient: client, recordCount, state, suggestions };
    })
    .sort((a, b) => b.recordCount - a.recordCount || a.uploadedClient.localeCompare(b.uploadedClient));
};

/**
 * Candidates that resolve on their own: an exact-strength match standing clearly
 * apart from the runner-up. Everything weaker waits for a human.
 */
export const autoResolvable = (
  resolutions: ClientResolution[]
): { uploadedClient: string; suggestion: ClientMatchSuggestion }[] =>
  resolutions
    .filter(
      (r) =>
        r.state === 'suggested' &&
        r.suggestions[0]?.score >= AUTO_RESOLVE_SCORE &&
        !isAmbiguous(r.suggestions)
    )
    .map((r) => ({ uploadedClient: r.uploadedClient, suggestion: r.suggestions[0] }));

/**
 * The client code an uploaded client string joins on, or null when it is
 * unresolved or was declared to have no counterpart. Callers must treat null as
 * "cannot be joined" rather than falling back to the name.
 */
export const clientCodeFor = (uploadedClient: string, aliases: ClientAlias[]): string | null => {
  const key = normalizeClientName(uploadedClient);
  const alias = aliases.find((a) => a.normalizedKey === key);
  return alias && alias.method !== 'none' && alias.clientCode ? alias.clientCode : null;
};

/**
 * Collapse per-country rows into one candidate per client code.
 *
 * The directory dataflow groups by client code, account name and country, so a
 * client operating in four countries arrives as four rows carrying the same
 * code. Presented as separate candidates they score identically, trip the
 * ambiguity check, and split the hours a reviewer uses to judge which account
 * is real — while the thing being chosen between is the same code either way.
 *
 * Collapsing by code keeps genuine ambiguity intact: two *different* codes
 * sharing an account name remain two candidates, which is a real question.
 */
export const collapseDirectoryByClientCode = (
  rows: {
    clientCode: string;
    accountName: string;
    /** A single country, as the source rows and the legacy stored shape carry. */
    country?: string;
    /** Several, as an already-collapsed entry carries. Both are accepted so a
     *  stored directory can be re-collapsed without being taken apart first. */
    countries?: string[];
    hours?: number;
    latestMonth?: string;
  }[]
): { entries: ClientDirectoryEntry[]; notes: string[] } => {
  const byCode = new Map<
    string,
    { entry: ClientDirectoryEntry; hoursSeen: boolean; names: Map<string, number> }
  >();
  const notes: string[] = [];

  for (const row of rows) {
    const code = row.clientCode.trim();
    if (!code) continue;

    const incoming = [...(row.countries ?? []), ...(row.country ? [row.country] : [])]
      .map((c) => c.trim())
      .filter(Boolean);
    const hours = typeof row.hours === 'number' ? row.hours : undefined;
    let bucket = byCode.get(code);

    if (!bucket) {
      bucket = {
        entry: {
          clientCode: code,
          accountName: row.accountName.trim(),
          countries: Array.from(new Set(incoming)),
          hours,
          latestMonth: row.latestMonth || undefined,
        },
        hoursSeen: hours !== undefined,
        names: new Map(),
      };
      byCode.set(code, bucket);
    } else {
      for (const country of incoming) {
        if (!bucket.entry.countries.includes(country)) bucket.entry.countries.push(country);
      }
      if (hours !== undefined) {
        bucket.entry.hours = (bucket.hoursSeen ? bucket.entry.hours ?? 0 : 0) + hours;
        bucket.hoursSeen = true;
      }
      if (row.latestMonth && (!bucket.entry.latestMonth || row.latestMonth > bucket.entry.latestMonth)) {
        bucket.entry.latestMonth = row.latestMonth;
      }
    }

    // Track how much weight sits behind each spelling of the name, so a
    // disagreement resolves to the dominant one rather than whichever row
    // happened to arrive first.
    const name = row.accountName.trim();
    if (name) bucket.names.set(name, (bucket.names.get(name) ?? 0) + (hours ?? 0));
  }

  for (const [code, bucket] of byCode) {
    if (bucket.names.size > 1) {
      const ranked = Array.from(bucket.names).sort((a, b) => b[1] - a[1]);
      bucket.entry.accountName = ranked[0][0];
      notes.push(
        `Client code ${code} carries ${bucket.names.size} different account names ` +
          `(${ranked.map(([n]) => `"${n}"`).join(', ')}); kept "${ranked[0][0]}".`
      );
    }
    bucket.entry.countries.sort();
  }

  return { entries: Array.from(byCode.values()).map((b) => b.entry), notes };
};

/**
 * Parse a pasted client directory — the quickest way to load candidates before
 * the dataset is mapped into the app.
 *
 * Accepts tab or comma separated rows, with or without a header, in the column
 * order the `rate_card_client_directory` dataflow emits:
 * `rsr_client_code, account_name, country, hours, latest_month`.
 */
export const parseClientDirectory = (
  text: string
): { entries: ClientDirectoryEntry[]; errors: string[] } => {
  const errors: string[] = [];
  /** Per-country rows, collapsed to one entry per client code below. */
  const entries: {
    clientCode: string;
    accountName: string;
    country?: string;
    hours?: number;
    latestMonth?: string;
  }[] = [];
  const seen = new Set<string>();

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  lines.forEach((line, index) => {
    const cells = (line.includes('\t') ? line.split('\t') : line.split(',')).map((c) =>
      c.trim().replace(/^"|"$/g, '')
    );

    const [code, name, country, hours, latestMonth] = cells;

    // Skip a header row rather than importing it as an account.
    if (index === 0 && /client.?code/i.test(code || '')) return;

    if (!code || !name) {
      errors.push(`Line ${index + 1}: needs at least a client code and an account name.`);
      return;
    }
    // A repeated code is normal: it is the same client in another country, and
    // the collapse below merges them.
    seen.add(code);

    const parsedHours = Number(String(hours ?? '').replace(/[^0-9.-]/g, ''));
    entries.push({
      clientCode: code,
      accountName: name,
      country: country || undefined,
      hours: Number.isFinite(parsedHours) && parsedHours > 0 ? parsedHours : undefined,
      latestMonth: latestMonth || undefined,
    });
  });

  if (!entries.length && lines.length) {
    errors.push('No usable rows found. Expected: client code, account name, country, hours, latest month.');
  }

  // Same collapse as the dataset route: a pasted export carries the same
  // one-row-per-country shape.
  const { entries: collapsed, notes } = collapseDirectoryByClientCode(entries);
  return { entries: collapsed, errors: [...errors, ...notes] };
};
