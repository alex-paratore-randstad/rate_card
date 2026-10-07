/**
 * One job title's pay range for one rate year, from one upload.
 *
 * The rate year comes from the column header (e.g. "Max Pay - National Average
 * (2026)"), which is what variance compares. `uploadedAt` records when the file
 * landed — not part of the data's identity, but it is how a later re-upload of
 * the same year can be seen to have moved.
 */
export interface RateCardRecord {
  id: string;
  /** Which upload produced this record; makes "latest upload per year" exact. */
  batchId: string;
  jobTitle: string;
  laborType?: string;
  minRate: number;
  maxRate: number;
  avgRate: number;
  rateSpread: number;
  /** "2025" — parsed from the column header, not from a date column. */
  rateYear: string;
  client?: string;
  country?: string;
  sourceFileName?: string;
  /** Which workbook tab the row came from, when the file had several. */
  sourceSheet?: string;
  /** ISO timestamp of the upload. */
  uploadedAt: string;
}

export interface NormalizedIngestionBatch {
  batchId: string;
  sourceFileName: string;
  /** Every rate year this upload carried, in file column order. */
  rateYears: string[];
  /** Distinct clients and countries the upload covered. */
  clients: string[];
  countries: string[];
  recordCount: number;
  /** How many records Domo actually confirmed, which can be fewer. */
  savedCount: number;
  status: 'ingested' | 'partial' | 'failed';
  /** Where the records went. A local save must never be labelled as Domo. */
  target: 'domo' | 'local';
  statusMessage: string;
  uploadedAt: string;
}

/** Batch-level tags applied to every row of an upload. */
export interface BatchMeta {
  client: string;
  country: string;
}

// Fields a source column can be mapped onto. The rate year is not mapped by the
// user — it is derived from the header text during the year unpivot.
export type CoreTargetFieldType =
  | 'jobTitle'
  | 'laborType'
  | 'minRate'
  | 'maxRate'
  | 'rateYear'
  | 'client'
  | 'country'
  | 'ignore';

export type TargetFieldType = CoreTargetFieldType;

export interface ColumnMapping {
  rawHeader: string;
  targetField: TargetFieldType;
  confidence: number; // 0 to 1
  isAutoMapped: boolean;
  sampleValues: string[];
}

export interface IngestionPreviewData {
  fileName: string;
  headers: string[];
  rawRows: Record<string, any>[];
  mappings: ColumnMapping[];
  /** Rate years found in the column headers, in file column order. */
  detectedYears?: string[];
  detectedClient?: string;
  detectedCountry?: string;
  /** Source rows before the year unpivot expanded them. */
  sourceRowCount?: number;
  /** Workbook tabs this preview was built from. */
  sheetNames?: string[];
  /** True when every row already has a client and country from tab overrides. */
  perTabTagged?: boolean;
  /** Distinct client and country values supplied per tab, for display. */
  tagSummary?: { clients: string[]; countries: string[] };
  validationErrors: string[];
}

export interface RateCardFilterState {
  /** Dashboard-wide scope. 'ALL' aggregates every client together. */
  client: string;
  /** Rates from different countries are not comparable; scope before reporting. */
  country: string;
}

// ---------------------------------------------------------------------------
// Client matching
//
// An uploaded client string ("Xerox") will not equal the name Domo holds
// ("Xerox Corporation"). The name is therefore never the join key — it is
// resolved once, by a human, onto `rsr_client_code`, and that decision is
// persisted so it is never asked again.
// ---------------------------------------------------------------------------

/**
 * One candidate client as Domo knows it. The directory is what we match against.
 *
 * One entry per `rsr_client_code`, never per country. The source emits a row
 * per client per country, but the join key is the code alone — so splitting
 * candidates by country asks a reviewer to choose between four rows that all
 * resolve to the same thing, and divides the hours that tell them which
 * account matters. Country is a separate dimension of the rate card, scoped
 * independently, and appears here only as context.
 */
export interface ClientDirectoryEntry {
  /** `rsr_client_code` — the canonical, stable id. This is the join key. */
  clientCode: string;
  /** `account_name`, exactly as Domo holds it. */
  accountName: string;
  /** Every country this client operates in, for the reviewer to recognise it by. */
  countries: string[];
  /**
   * Billable hours behind the account, across all its countries. Not used in
   * scoring — it is how a reviewer tells a live account from a dormant one when
   * two names look alike.
   */
  hours?: number;
  /** Latest reporting month seen, for the same reason. */
  latestMonth?: string;
}

/** The client directory, stored as one collection document and read wholesale. */
export interface ClientDirectory {
  entries: ClientDirectoryEntry[];
  /** ISO timestamp of when the directory was loaded. */
  loadedAt: string;
  /** How it arrived — pasted by hand, or read from a mapped dataset. */
  source: 'pasted' | 'dataset';
}

/**
 * How a match was arrived at. Kept on the record because the strength of the
 * evidence differs, and a report built on a guess must not look like one built
 * on an exact match.
 */
export type ClientMatchMethod =
  /** Normalized names were identical, against a single candidate. */
  | 'exact'
  /** A human accepted a suggested candidate. */
  | 'confirmed'
  /** A human picked a candidate the scorer did not suggest. */
  | 'manual'
  /** A human declared there is no counterpart in Domo. Stops the nagging. */
  | 'none';

/** A resolved pairing between an uploaded client string and a Domo account. */
export interface ClientAlias {
  /** The Domo collection document id, so a decision can be revised in place. */
  id: string;
  /** The client string exactly as it appeared in the upload. */
  uploadedClient: string;
  /** Normalized form of `uploadedClient`; the lookup key. */
  normalizedKey: string;
  /** Empty when `method` is 'none'. */
  clientCode: string;
  accountName: string;
  method: ClientMatchMethod;
  /** The score at the time of the decision, for later audit. */
  score: number;
  confirmedAt: string;
}

/** A scored candidate, with the reason shown to the reviewer. */
export interface ClientMatchSuggestion {
  entry: ClientDirectoryEntry;
  /** 0 to 1. */
  score: number;
  /** Plain-language basis for the score, e.g. "same name ignoring 'corporation'". */
  reason: string;
}

/** Where one uploaded client stands in the matching process. */
export type ClientResolutionState =
  | 'resolved'
  /** Scored high enough to propose, but a human has not accepted it. */
  | 'suggested'
  /** Top candidates are too close to call; picking one would be a guess. */
  | 'ambiguous'
  /** Nothing scored above the floor. */
  | 'unmatched'
  /** No directory loaded yet, so nothing could be scored. */
  | 'pending';

/** One row of the client matching review screen. */
export interface ClientResolution {
  uploadedClient: string;
  /** How many rate card records carry this client string. */
  recordCount: number;
  state: ClientResolutionState;
  alias?: ClientAlias;
  suggestions: ClientMatchSuggestion[];
}

// ---------------------------------------------------------------------------
// Title matching
//
// The same shape of problem as client matching, at a different scale. A client
// list is a handful of names resolved once; a title list is hundreds per
// client, so the queue has to be ordered by what is at stake and the obvious
// matches have to clear in bulk. There are also signals a client name does not
// have: two titles sharing an occupational code is evidence, and a candidate
// whose actual pay sits nowhere near the card band is evidence against.
// ---------------------------------------------------------------------------

/**
 * One title as it appears in the actuals, aggregated across its assignments.
 *
 * Derived from the assignment dataset already loaded for the coverage report
 * rather than from `rate_card_title_directory` — the numbers then cannot
 * disagree with the report the matcher exists to improve, and it needs no
 * second dataset mapping.
 */
export interface TitleCandidate {
  /** Normalized form; the join key. */
  titleKey: string;
  /** `title_cleaned` as Domo holds it. */
  title: string;
  clientCode: string;
  assignments: number;
  hours: number;
  /** Hours-weighted pay rate across the candidate's assignments. */
  weightedPayRate?: number;
  minPayRate?: number;
  maxPayRate?: number;
  /** Occupational codes, for matching a title to its peers by more than spelling. */
  socBroadGroup?: string;
  onetOccupation?: string;
  msCategory?: string;
  currencies: string[];
}

/** How a title pairing was arrived at. */
export type TitleMatchMethod = 'exact' | 'confirmed' | 'manual' | 'none';

/**
 * A confirmed pairing between a card title and an actuals title, for one client.
 *
 * Scoped per client rather than globally. A spelling equivalence would often
 * hold everywhere, but "Analyst" need not mean the same role at two accounts,
 * and the candidate list differs per client anyway — so the safe scope is the
 * one the report joins on.
 */
export interface TitleAlias {
  /** Domo collection document id. */
  id: string;
  clientCode: string;
  /** The card's title, exactly as uploaded. */
  cardTitle: string;
  /** Normalized card title; the lookup key alongside clientCode. */
  cardTitleKey: string;
  /** The actuals title this resolves to. Empty when method is 'none'. */
  actualTitle: string;
  actualTitleKey: string;
  method: TitleMatchMethod;
  score: number;
  confirmedAt: string;
}

/** A scored title candidate, with the basis shown to the reviewer. */
export interface TitleMatchSuggestion {
  candidate: TitleCandidate;
  score: number;
  reason: string;
  /** True when the candidate's actual pay overlaps the card band. */
  bandOverlaps?: boolean;
}

export type TitleResolutionState =
  | 'resolved'
  | 'suggested'
  | 'ambiguous'
  | 'unmatched'
  /** No candidates loaded, so nothing could be scored. */
  | 'pending';

/** One row of the title matching queue. */
export interface TitleResolution {
  clientCode: string;
  clientLabel: string;
  cardTitle: string;
  cardTitleKey: string;
  cardMinRate: number;
  cardMaxRate: number;
  /**
   * Hours behind the best unresolved candidate — what resolving this row would
   * bring into coverage. The queue is ordered by it, so the expensive titles
   * are reviewed first rather than whatever sorts alphabetically.
   */
  hoursAtStake: number;
  state: TitleResolutionState;
  alias?: TitleAlias;
  suggestions: TitleMatchSuggestion[];
}

// ---------------------------------------------------------------------------
// Title mappings
//
// A different thing from a TitleAlias, despite both pairing up job titles.
//
// A TitleAlias resolves a card title onto a title Domo already holds, per
// client, so a report can join the two. A TitleMapping resolves an uploaded
// title onto *our own* standard title, and is uploaded as a file rather than
// decided in the app. It needs no Domo connection and no client scope: a
// standard-title taxonomy is the same taxonomy at every account, which is what
// makes it worth having. Keeping them apart means neither has to compromise —
// the matcher keeps its per-client caution, and the taxonomy stays global.
// ---------------------------------------------------------------------------

/** One row of the uploaded mapping file. */
export interface TitleMapping {
  /** Domo collection document id. */
  id: string;
  /** The title as it appears in an ingested rate card. */
  uploadedTitle: string;
  /** `normalizeJobTitle(uploadedTitle)` — the lookup key. */
  uploadedTitleKey: string;
  /** The standard title it resolves to. */
  standardTitle: string;
  standardTitleKey: string;
  /** Optional groupings the file may carry. */
  family?: string;
  level?: string;
  sourceFileName?: string;
  uploadedAt: string;
}

/** Fields a column of the mapping file can be mapped onto. */
export type MappingTargetField =
  | 'uploadedTitle'
  | 'standardTitle'
  | 'family'
  | 'level'
  | 'ignore';

/** A proposed column assignment, shown for confirmation before the file loads. */
export interface MappingColumn {
  rawHeader: string;
  targetField: MappingTargetField;
  confidence: number;
  sampleValues: string[];
}

/** An uploaded mapping file, read but not yet stored. */
export interface TitleMappingPreview {
  fileName: string;
  /** Which workbook tab it was read from. */
  sheetName: string;
  /** Other tabs that held rows, so a wrong pick is visible. */
  otherSheets: string[];
  headers: string[];
  rows: Record<string, any>[];
  columns: MappingColumn[];
}

/** How an uploaded card title stands against the mapping file. */
export interface MappingCoverage {
  mapped: { uploadedTitle: string; standardTitle: string; recordCount: number }[];
  unmapped: { uploadedTitle: string; recordCount: number }[];
  /** Mappings that match no title in any ingested card — likely stale rows. */
  unusedMappings: number;
}
