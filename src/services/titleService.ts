/**
 * Normalizing job titles so a card title and an actual title can be compared.
 *
 * Deliberately conservative. This handles spelling and formatting variance —
 * "Sr." against "Senior", "II" against "2", punctuation and case — and nothing
 * more. It does not attempt to decide that "Software Engineer" and "Software
 * Developer" are the same role; that is a judgement, and judgements belong in
 * the title matcher with a human confirming them, the way client names work.
 *
 * The consequence matters for reading any report built on this: a title that
 * fails to match here is *unmatched*, which is not the same as uncovered. Until
 * the matcher exists those two have to be reported separately, or a matching
 * failure reads as a commercial finding.
 */

/** Abbreviations that are spelling variants of the same word, not distinctions. */
const WORD_EQUIVALENTS: Record<string, string> = {
  sr: 'senior',
  snr: 'senior',
  jr: 'junior',
  jnr: 'junior',
  mgr: 'manager',
  mgmt: 'management',
  eng: 'engineer',
  engr: 'engineer',
  dev: 'developer',
  admin: 'administrator',
  asst: 'assistant',
  assoc: 'associate',
  spec: 'specialist',
  tech: 'technician',
  coord: 'coordinator',
  analyt: 'analyst',
  sys: 'systems',
  ops: 'operations',
  qa: 'quality assurance',
  hr: 'human resources',
  it: 'information technology',
};

/**
 * Roman numerals as they appear in job levels. Converted to digits so
 * "Engineer II" and "Engineer 2" land together — the same level written two
 * ways, which is exactly the variance this function exists to absorb.
 *
 * Stops at V: beyond that a roman numeral in a job title is more likely to be
 * something else.
 */
const ROMAN_LEVELS: Record<string, string> = {
  i: '1',
  ii: '2',
  iii: '3',
  iv: '4',
  v: '5',
};

/**
 * Comparable form of a job title.
 *
 * Returns the empty string for anything with no alphanumeric content, which
 * callers must treat as "no title" rather than as a title that matches other
 * empty ones.
 */
export const normalizeJobTitle = (raw: string): string => {
  const base = (raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  if (!base) return '';

  const words = base.split(' ').flatMap((word) => {
    const expanded = WORD_EQUIVALENTS[word];
    if (expanded) return expanded.split(' ');
    // A roman numeral is only a level when it is not the whole title.
    if (ROMAN_LEVELS[word] && base !== word) return [ROMAN_LEVELS[word]];
    return [word];
  });

  return words.join(' ');
};

/** Whether two titles are the same once formatting variance is removed. */
export const titlesMatch = (a: string, b: string): boolean => {
  const left = normalizeJobTitle(a);
  return left !== '' && left === normalizeJobTitle(b);
};
