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
