export interface RateCardRecord {
  id: string;
  jobTitle: string;
  minRate: number;
  maxRate: number;
  avgRate: number;
  rateSpread: number;
  effectiveMonth: string; // ISO date or "Month YYYY"
  category?: string;
  region?: string;
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
  effectiveMonth: string;
  recordCount: number;
  records: RateCardRecord[];
  status: 'validated' | 'ingested' | 'failed';
  ingestionTimestamp: string;
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
  | 'effectiveMonth'
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
  detectedMonth: string;
  validationErrors: string[];
}

export interface RateCardFilterState {
  searchTerm: string;
  category: string;
  region: string;
  selectedMonth: string;
}

export interface RateCardMetricSummary {
  totalRoles: number;
  avgMinRate: number;
  avgMaxRate: number;
  avgSpread: number;
  monthlyDriftPercentage: number;
  totalBatchesCount: number;
}
