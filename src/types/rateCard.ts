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
  currency: string;
  sourceFileName?: string;
  ingestionDate: string;
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

export type TargetFieldType =
  | 'jobTitle'
  | 'minRate'
  | 'maxRate'
  | 'effectiveMonth'
  | 'category'
  | 'region'
  | 'skillLevel'
  | 'currency'
  | 'ignore';

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
