import * as XLSX from 'xlsx';
import {
  RateCardRecord,
  StandardTitleCandidate,
  StandardTitleEdit,
  StandardTitleList,
  TitleMapping,
  TitleMatchConfidence,
  StandardTitleResolution,
} from '../types/rateCard';
import { normalizeJobTitle } from './titleService';
import { diceCoefficient } from './stringSimilarity';

/**
 * Matching uploaded card titles onto the standard title list.
 *
 * The list is the taxonomy: one column of titles, with no say about which card
 * spellings belong to each. So every card title is matched automatically, the
 * match applies straight away, and a reviewer confirms or corrects it. Only
 * the reviewed decisions are stored — a proposal is recomputed from the list
 * whenever the cards or the list change, so a newly uploaded card is matched
 * the moment it lands rather than waiting for someone to re-run anything.
 *
 * Every key goes through `normalizeJobTitle`, the app's one notion of title
 * identity, so "Sr. Software Eng. II" and "Senior Software Engineer 2" are the
 * same card title before matching even starts.
 */

// ---------------------------------------------------------------------------
// Reading the list
// ---------------------------------------------------------------------------

/** Header cells that mean "this column is the list", not a title in it. */
const HEADER_WORDS = /\b(job )?titles?\b|\bstandard\b|\bposition\b|\brole\b/;

/**
 * Read an uploaded standard title list.
 *
 * The file is expected to be one column of titles, with or without a header —
 * the one this was built against has none, and treating its first row as a
 * header would have silently dropped "Account Analyst". A first cell is taken
 * as a header only when it reads like one ("Job Title", "Standard Titles").
 *
 * Duplicates are dropped and reported rather than kept, since two spellings of
 * one standard would split a role across two rows of every report.
 */
export const readStandardTitleFile = (file: File): Promise<StandardTitleList & { duplicates: string[] }> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const workbook = XLSX.read(new Uint8Array(e.target?.result as ArrayBuffer), {
          type: 'array',
        });

        // A column headed "Standard Title" wins outright — that is how this
        // app exports the list, and the export's second tab has a longer
        // column of card titles that would otherwise be read instead.
        // Failing that, the column with the most filled cells wins.
        let best: string[] = [];
        let bestSheet = '';
        let headed = false;
        for (const name of workbook.SheetNames) {
          const matrix = XLSX.utils.sheet_to_json<any[]>(workbook.Sheets[name], {
            header: 1,
            defval: '',
          }) as any[][];
          const width = Math.max(0, ...matrix.map((r) => r.length));
          for (let col = 0; col < width; col += 1) {
            const values = matrix.map((r) => String(r[col] ?? '').trim()).filter(Boolean);
            const isHeaded = /^standard titles?$/i.test(values[0] ?? '');
            if (headed && !isHeaded) continue;
            if ((isHeaded && !headed) || values.length > best.length) {
              best = values;
              bestSheet = name;
              headed = headed || isHeaded;
            }
          }
        }

        if (!best.length) {
          reject(new Error('No titles were found in that file.'));
          return;
        }

        const first = best[0].toLowerCase();
        const values =
          HEADER_WORDS.test(first) && !standardKeyCollides(first, best.slice(1))
            ? best.slice(1)
            : best;

        const seen = new Set<string>();
        const titles: string[] = [];
        const duplicates: string[] = [];
        for (const title of values) {
          const key = normalizeJobTitle(title);
          if (!key) continue;
          if (seen.has(key)) {
            duplicates.push(title);
            continue;
          }
          seen.add(key);
          titles.push(title);
        }

        resolve({
          titles,
          sourceFileName:
            workbook.SheetNames.length > 1 ? `${file.name} · ${bestSheet}` : file.name,
          uploadedAt: '',
          duplicates,
        });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });

/** Whether a would-be header is itself a title the rest of the list uses. */
const standardKeyCollides = (cell: string, rest: string[]): boolean => {
  const key = normalizeJobTitle(cell);
  return rest.some((t) => normalizeJobTitle(t) === key);
};

// ---------------------------------------------------------------------------
// Comparable forms
// ---------------------------------------------------------------------------

/**
 * Words that say how senior a role is, or how it is engaged, rather than what
 * it is. The standard list carries none of them — it has "Software Engineer",
 * not "Senior Software Engineer II" — so they are taken off the card title
 * before matching and kept as the level. Digits are here because
 * `normalizeJobTitle` has already turned "II" into "2".
 */
const LEVEL_WORDS = new Set([
  'senior',
  'junior',
  'lead',
  'principal',
  'staff',
  'level',
  'mid',
  'intermediate',
  'experienced',
  'trainee',
  'apprentice',
  'journeyman',
  '1',
  '2',
  '3',
  '4',
  '5',
]);

const NOISE_WORDS = new Set([
  'contract',
  'contractor',
  'temp',
  'temporary',
  'remote',
  'hybrid',
  'onsite',
  'part',
  'full',
  'time',
  'the',
  'to',
  'for',
  'at',
  'in',
  'of',
  'and',
]);

/**
 * Spellings of one role that `normalizeJobTitle` deliberately leaves apart.
 *
 * That function absorbs formatting only; deciding that a developer and an
 * engineer are the same job is a judgement, and here it is the right one —
 * the list says "Software Engineer" and means everyone who writes software.
 * Applied to both sides, so a list that does name a developer still finds it.
 */
const PHRASE_EQUIVALENTS: [RegExp, string][] = [
  // Multi-word expansions from normalizeJobTitle collapse back to one token
  // here, or "IT Manager" outscores "Project Manager" for "IT Project
  // Manager" on the strength of two words that are really one.
  [/\binformation technology\b/g, 'it'],
  [/\bhuman resources\b/g, 'hr'],
  [/\bquality assurance\b/g, 'qa'],
  [/\bquality control\b/g, 'qc'],
  [/\bquality\b/g, 'qa'],
  [/\ba p\b/g, 'accounts payable'],
  [/\ba r\b/g, 'accounts receivable'],
  [/\bclerk\b/g, 'associate'],
  [/\blab\b/g, 'laboratory'],
  [/\bcopy writer\b/g, 'copywriter'],
  [/\bsecurity officer\b/g, 'security guard'],
  [/\bexecutive administrator\b/g, 'executive assistant'],
  [/\b(help|service) desk\b/g, 'it support'],
  [/\bdesktop support\b/g, 'it support'],
  [/\bfront end\b/g, 'frontend'],
  [/\bback end\b/g, 'backend'],
  [/\bfullstack\b/g, 'full stack'],
  [/\bdeveloper\b/g, 'engineer'],
  [/\bprogrammer\b/g, 'engineer'],
  [/\bbi\b/g, 'business intelligence'],
  [/\bml\b/g, 'machine learning'],
  [/\bsre\b/g, 'site reliability engineer'],
  [/\bdba\b/g, 'database administrator'],
  [/\bcsr\b/g, 'customer service representative'],
  [/\brep\b/g, 'representative'],
  [/\bap\b/g, 'accounts payable'],
  [/\bar\b/g, 'accounts receivable'],
  [/\bhse\b/g, 'ehs'],
  [/\bcyber ?security\b/g, 'cyber security'],
  [/\binfosec\b/g, 'cyber security'],
  [/\bux ui\b/g, 'ui ux'],
  [/\bux\b(?! )/g, 'ui ux'],
];

/** Card title split into what the role is and how senior it is. */
const splitLevel = (key: string): { core: string; level: string[] } => {
  // "Entry level" is a level; "entry" alone is the job in "Data Entry Clerk".
  const words = key.replace(/\bentry level\b/g, 'level').split(' ');
  const core = words.filter((w) => !LEVEL_WORDS.has(w) && !NOISE_WORDS.has(w));
  const level = words.filter((w) => LEVEL_WORDS.has(w));
  // A title that is nothing but level words ("Lead") keeps them as its role.
  return core.length ? { core: core.join(' '), level } : { core: key, level: [] };
};

const canonical = (core: string): string => {
  let out = ` ${core} `;
  for (const [pattern, replacement] of PHRASE_EQUIVALENTS) out = out.replace(pattern, replacement);
  return out.replace(/\s+/g, ' ').trim();
};

const SUFFIXES = ['ation', 'ative', 'ement', 'ment', 'ator', 'ing', 'ant', 'ive', 'ion', 'er', 'or', 'al', 'e', 's'];

/**
 * A crude stem, used only for scoring. Enough to put "administrative",
 * "administrator" and "administration" together, and "accounting" with
 * "accountant" — the variance a title list sees most — without a dictionary.
 */
const stem = (word: string): string => {
  let w = word;
  for (let pass = 0; pass < 3; pass += 1) {
    const suffix = SUFFIXES.find((s) => w.endsWith(s) && w.length - s.length >= 4);
    if (!suffix) break;
    w = w.slice(0, -suffix.length);
  }
  return w;
};

interface Prepared {
  title: string;
  key: string;
  canon: string;
  stems: string[];
  /** The role noun — "analyst" in "Data Analyst" — which matters most. */
  head: string;
}

/**
 * `heads` is the set of role nouns the standard list uses. A card title's head
 * is its last word that is one of them, so "Electrical Engineer - Controls"
 * is an engineer, not a control.
 */
const prepare = (title: string, heads?: Set<string>): Prepared => {
  const key = normalizeJobTitle(title);
  const canon = canonical(key);
  const stems = canon.split(' ').filter((w) => w && !NOISE_WORDS.has(w)).map(stem);
  const head =
    (heads && [...stems].reverse().find((s) => heads.has(s))) ?? stems[stems.length - 1] ?? '';
  return { title, key, canon, stems, head };
};

/**
 * How well a card title describes a standard one, 0 to 1.
 *
 * Token overlap does most of the work, weighted so the standard's role noun
 * counts double: "Data Analyst" against "Data Engineer" shares a word but not
 * the job, and should score well under "Business Analyst". Character
 * similarity is blended in for typos and run-together words.
 *
 * Two markdowns guard the errors most worth avoiding. A card whose role noun
 * appears nowhere in the standard is not that job — "Payroll Clerk" is not a
 * "Payroll Manager" on the strength of "payroll". And a card whose every
 * qualifying word is missing from the standard is not that job either —
 * "Warehouse Associate" shares only "associate" with "Research Associate".
 */
const scoreAgainst = (card: Prepared, std: Prepared): number => {
  if (card.canon === std.canon) return 1;

  const cardStems = new Set(card.stems);
  const stdWeight = std.stems.reduce((n, s) => n + (s === std.head ? 2 : 1), 0);
  const matchedWeight = std.stems.reduce(
    (n, s) => n + (cardStems.has(s) ? (s === std.head ? 2 : 1) : 0),
    0
  );
  const recall = stdWeight ? matchedWeight / stdWeight : 0;
  const stdStems = new Set(std.stems);
  const precision = card.stems.length
    ? card.stems.filter((s) => stdStems.has(s)).length / card.stems.length
    : 0;
  const overlap = recall + precision ? (2 * recall * precision) / (recall + precision) : 0;

  let score = 0.7 * overlap + 0.3 * diceCoefficient(card.canon, std.canon);
  if (!stdStems.has(card.head)) score *= 0.75;
  const qualifiers = card.stems.filter((s) => s !== card.head);
  if (qualifiers.length && !qualifiers.some((s) => stdStems.has(s))) score *= 0.75;
  return Math.min(score, 0.99);
};

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** Below this a proposal is not applied, only offered. */
export const MIN_APPLIED_SCORE = 0.55;

const confidenceOf = (top: StandardTitleCandidate | undefined, runnerUp?: StandardTitleCandidate): TitleMatchConfidence => {
  if (!top) return 'none';
  if (top.score >= 1) return 'exact';
  if (top.score < MIN_APPLIED_SCORE) return 'none';
  // Two standards nearly tied is a guess however high both score.
  const contested = !!runnerUp && top.score - runnerUp.score < 0.05;
  if (top.score >= 0.8 && !contested) return 'high';
  if (top.score >= 0.65) return 'medium';
  return 'low';
};

/**
 * A matcher bound to one standard list.
 *
 * The list is prepared once and indexed by stem, so each card title is scored
 * only against standards sharing at least one word with it. Without the index
 * a few thousand card titles against 450 standards is a noticeable pause on
 * every render that touches the cards.
 */
export const createTitleMatcher = (standardTitles: string[]) => {
  const prepared = standardTitles.map((t) => prepare(t));
  const heads = new Set(prepared.map((p) => p.head));
  const byCanon = new Map<string, Prepared>();
  const byStem = new Map<string, Prepared[]>();
  for (const std of prepared) {
    if (!byCanon.has(std.canon)) byCanon.set(std.canon, std);
    for (const s of new Set(std.stems)) {
      const list = byStem.get(s) ?? [];
      list.push(std);
      byStem.set(s, list);
    }
  }

  return (uploadedTitle: string): { candidates: StandardTitleCandidate[]; level: string[] } => {
    const { core, level } = splitLevel(normalizeJobTitle(uploadedTitle));
    const card = prepare(core, heads);

    const exact = byCanon.get(card.canon);
    if (exact) return { candidates: [{ standardTitle: exact.title, score: 1 }], level };

    const pool = new Set<Prepared>();
    for (const s of card.stems) for (const std of byStem.get(s) ?? []) pool.add(std);

    const candidates = Array.from(pool, (std) => ({
      standardTitle: std.title,
      score: scoreAgainst(card, std),
    }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    return { candidates, level };
  };
};

const titleCase = (word: string): string =>
  /^\d$/.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1);

/**
 * Every distinct card title, matched and joined to any reviewed decision.
 *
 * Counted in records so the review list can lead with the titles that carry
 * the most of the card. A decision stored for a title no card holds any more
 * is not returned here; it stays stored, and applies again if the title
 * comes back.
 */
export const resolveTitles = (
  cards: RateCardRecord[],
  standardTitles: string[],
  decisions: TitleMapping[]
): StandardTitleResolution[] => {
  const counts = new Map<string, { title: string; count: number }>();
  for (const card of cards) {
    const title = (card.jobTitle || '').trim();
    const key = normalizeJobTitle(title);
    if (!key) continue;
    const entry = counts.get(key) ?? { title, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }

  const match = standardTitles.length ? createTitleMatcher(standardTitles) : null;
  const decided = new Map(decisions.map((d) => [d.uploadedTitleKey, d]));

  const out: StandardTitleResolution[] = [];
  for (const [key, { title, count }] of counts) {
    const { candidates, level } = match ? match(title) : { candidates: [], level: [] };
    const confidence = confidenceOf(candidates[0], candidates[1]);
    const proposed = confidence === 'none' ? null : candidates[0];
    const decision = decided.get(key);

    let status: StandardTitleResolution['status'];
    let standardTitle: string | null;
    if (decision) {
      status = decision.standardTitle ? 'confirmed' : 'rejected';
      standardTitle = decision.standardTitle || null;
    } else if (proposed) {
      status = 'auto';
      standardTitle = proposed.standardTitle;
    } else {
      status = 'unmatched';
      standardTitle = null;
    }

    out.push({
      uploadedTitle: title,
      uploadedTitleKey: key,
      recordCount: count,
      level: level.length ? level.map(titleCase).join(' ') : undefined,
      candidates,
      proposed,
      confidence,
      decision,
      standardTitle,
      status,
    });
  }

  return out.sort((a, b) => b.recordCount - a.recordCount);
};

/** Whether a resolution still wants a person to look at it. */
export const needsReview = (r: StandardTitleResolution): boolean =>
  r.status === 'unmatched' ||
  (r.status === 'auto' && (r.confidence === 'medium' || r.confidence === 'low'));

/**
 * The mappings reports group by: reviewed decisions first, then the matcher's
 * proposals for every title nobody has reviewed. Decisions for titles no card
 * currently holds are included too — they cost nothing and keep a report
 * built on an older card consistent.
 */
export const effectiveMappings = (
  resolutions: StandardTitleResolution[],
  decisions: TitleMapping[]
): TitleMapping[] => {
  const out = new Map<string, TitleMapping>();
  for (const d of decisions) if (d.standardTitle) out.set(d.uploadedTitleKey, d);
  for (const r of resolutions) {
    if (r.status !== 'auto' || !r.proposed || out.has(r.uploadedTitleKey)) continue;
    out.set(r.uploadedTitleKey, {
      id: `auto-${r.uploadedTitleKey}`,
      uploadedTitle: r.uploadedTitle,
      uploadedTitleKey: r.uploadedTitleKey,
      standardTitle: r.proposed.standardTitle,
      standardTitleKey: normalizeJobTitle(r.proposed.standardTitle),
      level: r.level,
      method: 'auto',
      score: r.proposed.score,
      uploadedAt: '',
    });
  }
  return Array.from(out.values());
};

/** A reviewed decision for one card title. An empty standard means "none fits". */
export const buildDecision = (
  resolution: StandardTitleResolution,
  standardTitle: string,
  decidedAt: string
): TitleMapping => ({
  id: resolution.decision?.id ?? '',
  uploadedTitle: resolution.uploadedTitle,
  uploadedTitleKey: resolution.uploadedTitleKey,
  standardTitle,
  standardTitleKey: normalizeJobTitle(standardTitle),
  level: resolution.level,
  method: 'reviewed',
  score: resolution.candidates.find((c) => c.standardTitle === standardTitle)?.score,
  uploadedAt: decidedAt,
});

// ---------------------------------------------------------------------------
// Maintaining the list in the app
// ---------------------------------------------------------------------------

export interface ListEditResult {
  titles: string[];
  /** Titles an add left out, with the reason. */
  skipped: { title: string; reason: string }[];
  error?: string;
}

const byTitle = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

/**
 * Apply one edit to a list of standard titles.
 *
 * Identity is the normalised key, the same as everywhere else, so "Sr Data
 * Analyst" cannot be added beside "Senior Data Analyst" and a rename cannot
 * land on a title that is already there. The list is kept alphabetical, which
 * is how the uploaded list arrived and how people look things up in it.
 */
export const applyStandardTitleEdit = (titles: string[], edit: StandardTitleEdit): ListEditResult => {
  const keyed = new Map(titles.map((t) => [normalizeJobTitle(t), t]));

  if (edit.kind === 'add') {
    const skipped: ListEditResult['skipped'] = [];
    for (const raw of edit.titles) {
      const title = raw.replace(/\s+/g, ' ').trim();
      if (!title) continue;
      const key = normalizeJobTitle(title);
      const existing = keyed.get(key);
      if (!key) skipped.push({ title, reason: 'has no letters or digits' });
      else if (existing) skipped.push({ title, reason: `already on the list as "${existing}"` });
      else keyed.set(key, title);
    }
    return { titles: Array.from(keyed.values()).sort(byTitle), skipped };
  }

  if (edit.kind === 'rename') {
    const fromKey = normalizeJobTitle(edit.from);
    const to = edit.to.replace(/\s+/g, ' ').trim();
    const toKey = normalizeJobTitle(to);
    if (!keyed.has(fromKey)) {
      return { titles, skipped: [], error: `"${edit.from}" is no longer on the list.` };
    }
    if (!toKey) return { titles, skipped: [], error: 'The new title is empty.' };
    if (toKey !== fromKey && keyed.has(toKey)) {
      return { titles, skipped: [], error: `"${keyed.get(toKey)}" is already on the list.` };
    }
    keyed.delete(fromKey);
    keyed.set(toKey, to);
    return { titles: Array.from(keyed.values()).sort(byTitle), skipped: [] };
  }

  const key = normalizeJobTitle(edit.title);
  keyed.delete(key);
  return { titles: Array.from(keyed.values()).sort(byTitle), skipped: [] };
};

/** How many current card titles, and records, each standard title holds. */
export const standardTitleUsage = (
  resolutions: StandardTitleResolution[]
): Map<string, { cardTitles: number; records: number }> => {
  const usage = new Map<string, { cardTitles: number; records: number }>();
  for (const r of resolutions) {
    if (!r.standardTitle) continue;
    const key = normalizeJobTitle(r.standardTitle);
    const entry = usage.get(key) ?? { cardTitles: 0, records: 0 };
    entry.cardTitles += 1;
    entry.records += r.recordCount;
    usage.set(key, entry);
  }
  return usage;
};

const STATUS_LABEL: Record<StandardTitleResolution['status'], string> = {
  confirmed: 'Reviewed',
  rejected: 'Reviewed - none fits',
  auto: 'Automatic',
  unmatched: 'No match',
};

/**
 * The list as a workbook: the titles on the first tab, how every card title
 * resolves on the second. The first tab is headed "Standard Title" so the
 * file can be uploaded again as it is.
 */
export const exportStandardTitles = (
  list: StandardTitleList,
  resolutions: StandardTitleResolution[]
): void => {
  const usage = standardTitleUsage(resolutions);
  const listRows = [...list.titles].sort(byTitle).map((title) => {
    const u = usage.get(normalizeJobTitle(title));
    return {
      'Standard Title': title,
      'Card Titles Matched': u?.cardTitles ?? 0,
      Records: u?.records ?? 0,
    };
  });

  const matchRows = [...resolutions]
    .sort((a, b) => byTitle(a.uploadedTitle, b.uploadedTitle))
    .map((r) => ({
      'Card Title': r.uploadedTitle,
      Level: r.level ?? '',
      'Matched Standard Title': r.standardTitle ?? '',
      Status: STATUS_LABEL[r.status],
      Confidence:
        r.decision || r.confidence === 'none'
          ? ''
          : r.confidence.charAt(0).toUpperCase() + r.confidence.slice(1),
      Score: r.proposed && !r.decision ? Math.round(r.proposed.score * 100) / 100 : '',
      Records: r.recordCount,
    }));

  const workbook = XLSX.utils.book_new();
  const listSheet = XLSX.utils.json_to_sheet(listRows);
  listSheet['!cols'] = [{ wch: 40 }, { wch: 20 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(workbook, listSheet, 'Standard Titles');
  const matchSheet = XLSX.utils.json_to_sheet(matchRows);
  matchSheet['!cols'] = [{ wch: 40 }, { wch: 12 }, { wch: 40 }, { wch: 20 }, { wch: 12 }, { wch: 8 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(workbook, matchSheet, 'Title Matches');

  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `Standard Titles ${date}.xlsx`);
};
