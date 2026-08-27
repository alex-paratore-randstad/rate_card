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
