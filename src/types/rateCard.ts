export interface RateCardRecord {
  id: string;
  jobTitle: string;
  minRate: number;
  maxRate: number;
  avgRate: number;
  rateSpread: number;
  effectiveDate: string; // Exact effective date, "YYYY-MM-DD"
  client?: string;       // Client / account the report belongs to
  reportType?: string;   // Report type or name, for tracking a recurring report over time
  category?: string;
  region?: string;
  /**
   * Zero-based position of the region band in the source file, so a pricing
   * ladder (Base, Mid, Premium) keeps its order in reports. Averages cannot be
   * used to infer this: a role missing from one tier skews that tier's mean.
   */
  regionOrder?: number;
  skillLevel?: string;
  laborType?: string;
  currency: string;
  sourceFileName?: string;
  ingestionDate: string;
  customFields?: Record<string, string | number>; // User-defined fields captured at upload
}

export interface NormalizedIngestionBatch {
  batchId: string;
  sourceFileName: string;
  effectiveDate: string;
  client?: string;
  reportType?: string;
  recordCount: number;
  records: RateCardRecord[];
  status: 'validated' | 'ingested' | 'failed';
  ingestionTimestamp: string;
}

/** Batch-level tags applied to every row of an upload. */
export interface BatchMeta {
  effectiveDate: string;
  client: string;
  reportType: string;
}

/** A user-defined mappable field that appears in the column mapping dropdown */
export interface FieldDefinition {
  key: string;   // Unique identifier e.g. "site", "mra_min_bill_rate"
  label: string; // Display label e.g. "Site", "MRA Min Suggested Bill Rate"
  fieldType: 'text' | 'number';
}

// Core hardcoded field types that drive analytics
export type CoreTargetFieldType =
  | 'jobTitle'
  | 'minRate'
  | 'maxRate'
  | 'effectiveDate'
  | 'client'
  | 'reportType'
  | 'category'
  | 'region'
  | 'skillLevel'
  | 'laborType'
  | 'currency'
  | 'ignore';

// Dynamic custom field keys are prefixed with "custom:" e.g. "custom:site"
export type TargetFieldType = CoreTargetFieldType | `custom:${string}`;

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
  detectedDate: string;
  detectedClient?: string;
  detectedReportType?: string;
  /** Region bands found in a wide regional report, in file column order. */
  detectedRegions?: string[];
  /** Source rows before the regional unpivot expanded them. */
  sourceRowCount?: number;
  validationErrors: string[];
}

export interface RateCardFilterState {
  searchTerm: string;
  category: string;
  region: string;
  selectedDate: string;
  /** Dashboard-wide client scope. 'ALL' aggregates every client together. */
  client: string;
}

export interface RateCardMetricSummary {
  totalRoles: number;
  avgMinRate: number;
  avgMaxRate: number;
  avgSpread: number;
  monthlyDriftPercentage: number;
  totalBatchesCount: number;
}
