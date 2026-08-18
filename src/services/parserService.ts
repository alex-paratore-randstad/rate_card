import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { ColumnMapping, IngestionPreviewData, TargetFieldType, RateCardRecord, FieldDefinition, BatchMeta } from '../types/rateCard';

/** Synthesised column name the unpivot writes the band name into. */
const REGION_HEADER = 'Region';

const HEADER_ALIASES: Record<TargetFieldType, string[]> = {
  jobTitle: ['job title', 'title', 'role', 'position', 'job', 'designation', 'job_title', 'job family'],
  minRate: ['min rate', 'pay min', 'minimum rate', 'min', 'min_rate', 'min bill rate', 'min pay rate', 'minimum pay', 'rate (min)'],
  maxRate: ['max rate', 'pay max', 'maximum rate', 'max', 'max_rate', 'max bill rate', 'max pay rate', 'maximum pay', 'rate (max)'],
  effectiveDate: ['effective date', 'effective month', 'month', 'date', 'period', 'report month', 'month year', 'as of date', 'as of', 'rate effective date'],
  client: ['client', 'client name', 'customer', 'customer name', 'account', 'account name', 'company', 'msp', 'program'],
  reportType: ['report type', 'report name', 'report', 'rate card type', 'card type', 'report category'],
  category: ['category', 'domain', 'practice', 'department', 'vertical', 'business unit', 'job class', 'job classification', 'class'],
  region: ['region', 'location', 'market', 'country', 'geography', 'site', 'office'],
  skillLevel: ['skill level', 'level', 'seniority', 'tier', 'grade', 'experience level'],
  laborType: ['labor type', 'labour type', 'worker type', 'worker category', 'employment type', 'work type', 'labor_type', 'worker_type', 'type of labor', 'labor classification', 'resource type'],
  currency: ['currency', 'curr', 'currency code'],
  ignore: [],
};

/**
 * Auto-detect matching target field for a raw header string
 */
export const detectColumnMapping = (header: string, sampleValues: string[]): ColumnMapping => {
  const normalizedHeader = header.trim().toLowerCase();
  
  let bestMatch: TargetFieldType = 'ignore';
  let highestConfidence = 0;

  for (const [targetField, aliases] of Object.entries(HEADER_ALIASES)) {
    if (targetField === 'ignore') continue;
    
    for (const alias of aliases) {
      if (normalizedHeader === alias) {
        bestMatch = targetField as TargetFieldType;
        highestConfidence = 1.0;
        break;
      } else if (normalizedHeader.includes(alias) || alias.includes(normalizedHeader)) {
        if (0.8 > highestConfidence) {
          bestMatch = targetField as TargetFieldType;
          highestConfidence = 0.8;
        }
      }
    }
    if (highestConfidence === 1.0) break;
  }

  // Fallback heuristic based on sample value inspection if unmapped
  if (bestMatch === 'ignore') {
    const isNumericSample = sampleValues.some(v => !isNaN(parseFloat(v)) && isFinite(Number(v)));
    if (isNumericSample && normalizedHeader.includes('min')) {
      bestMatch = 'minRate';
      highestConfidence = 0.7;
    } else if (isNumericSample && normalizedHeader.includes('max')) {
      bestMatch = 'maxRate';
      highestConfidence = 0.7;
    }
  }

  return {
    rawHeader: header,
    targetField: bestMatch,
    confidence: highestConfidence,
    isAutoMapped: bestMatch !== 'ignore',
    sampleValues: sampleValues.slice(0, 3),
  };
};

/**
 * Parse uploaded file (CSV or XLSX) into raw rows & column mappings
 */
export const parseRateCardFile = async (file: File): Promise<IngestionPreviewData> => {
  const fileName = file.name;
  const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');

  if (isExcel) {
    return parseExcelFile(file);
  } else {
    return parseCSVFile(file);
  }
};

/** First non-empty value in the column mapped to `targetField`, if any. */
const firstMappedValue = (
  rawRows: Record<string, any>[],
  mappings: ColumnMapping[],
  targetField: TargetFieldType
): string | undefined => {
  const mapping = mappings.find((m) => m.targetField === targetField);
  if (!mapping) return undefined;
  for (const row of rawRows) {
    const value = row[mapping.rawHeader];
    if (value !== undefined && String(value).trim() !== '') return String(value).trim();
  }
  return undefined;
};

/**
 * Shared preview assembly for both CSV and XLSX. Keeps column detection,
 * validation, and batch-tag detection in one place so the two file formats
 * cannot drift apart.
 */
const buildPreview = (
  fileName: string,
  headers: string[],
  rawRows: Record<string, any>[],
  detectedRegions?: string[],
  sourceRowCount?: number
): IngestionPreviewData => {
  const mappings = headers.map((header) => {
    const sampleValues = rawRows.slice(0, 5).map((row) => String(row[header] ?? ''));
    return detectColumnMapping(header, sampleValues);
  });

  const validationErrors: string[] = [];
  if (!mappings.some((m) => m.targetField === 'jobTitle')) {
    validationErrors.push('Warning: Could not automatically detect a "Job Title / Role" column.');
  }
  if (!mappings.some((m) => m.targetField === 'minRate')) {
    validationErrors.push('Warning: Could not automatically detect a "Minimum Rate" column.');
  }
  if (!mappings.some((m) => m.targetField === 'maxRate')) {
    validationErrors.push('Warning: Could not automatically detect a "Maximum Rate" column.');
  }

  // Prefer a date carried in the data itself; fall back to the file name.
  const dateFromColumn = firstMappedValue(rawRows, mappings, 'effectiveDate');
  const detectedDate = normalizeDateValue(dateFromColumn) || extractDateFromFileName(fileName);

  return {
    fileName,
    headers,
    rawRows,
    mappings,
    detectedDate,
    detectedClient: firstMappedValue(rawRows, mappings, 'client'),
    detectedReportType: firstMappedValue(rawRows, mappings, 'reportType'),
    detectedRegions,
    sourceRowCount,
    validationErrors,
  };
};

// ---------------------------------------------------------------------------
// Raw matrix handling
//
// Both file formats are read as an array of arrays first, because a wide
// regional report carries TWO header rows: a merged region band over paired
// min/max columns. Reading straight to object rows (the previous behaviour)
// only ever sees the band and never the real labels underneath it.
// ---------------------------------------------------------------------------

type RawMatrix = any[][];

const cellText = (value: unknown): string => String(value ?? '').trim();

const rowIsEmpty = (row: any[]): boolean => !row || row.every((c) => cellText(c) === '');

/**
 * A wide regional layout is identified by the shape of its first two rows:
 * row 0 is a sparse merged band (a value followed by blanks under the merge),
 * row 1 is a densely populated header row that repeats a label once per band.
 *
 * All three signals are required together. A conventional file fails the first
 * check immediately, because its header row has no blanks to speak of.
 */
export const detectWideRegionalLayout = (matrix: RawMatrix): boolean => {
  if (!matrix || matrix.length < 3) return false;

  const width = Math.max(matrix[0]?.length ?? 0, matrix[1]?.length ?? 0);
  if (width < 3) return false;

  const bandRow = matrix[0] ?? [];
  const labelRow = matrix[1] ?? [];

  const bandFilled = bandRow.filter((c) => cellText(c) !== '').length;
  const labelFilled = labelRow.filter((c) => cellText(c) !== '').length;

  // Sparse band row: merged cells leave most of the row blank.
  if (bandFilled < 1 || bandFilled >= width * 0.6) return false;

  // Dense label row: this is the real header.
  if (labelFilled < width * 0.8) return false;

  // The same measure repeats under each band.
  const labels = labelRow.map((c) => cellText(c).toLowerCase()).filter(Boolean);
  const seen = new Set<string>();
  return labels.some((l) => (seen.has(l) ? true : (seen.add(l), false)));
};

/** Carry each merged band value across the blank cells it spans. */
const forwardFill = (row: any[], width: number): string[] => {
  const out: string[] = [];
  let current = '';
  for (let i = 0; i < width; i++) {
    const value = cellText(row?.[i]);
    if (value !== '') current = value;
    out.push(current);
  }
  return out;
};

/** Make a header list unique and non-empty so object keys never collide. */
const uniqueHeaders = (labels: string[]): string[] => {
  const seen = new Map<string, number>();
  return labels.map((label, i) => {
    const base = label || `Column ${i + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });
};

/** Conventional single-header file: row 0 is the header, the rest is data. */
const matrixToObjectRows = (
  matrix: RawMatrix
): { headers: string[]; rows: Record<string, any>[] } => {
  if (!matrix.length) return { headers: [], rows: [] };

  const width = matrix.reduce((max, row) => Math.max(max, row?.length ?? 0), 0);
  const headers = uniqueHeaders(
    Array.from({ length: width }, (_, i) => cellText(matrix[0]?.[i]))
  );

  const rows = matrix.slice(1).filter((row) => !rowIsEmpty(row)).map((row) => {
    const obj: Record<string, any> = {};
    headers.forEach((h, i) => {
      obj[h] = row?.[i] ?? '';
    });
    return obj;
  });

  return { headers, rows };
};

/**
 * Turn a wide regional report into long rows — one per source row per region.
 *
 * Columns under a merged band belong to that region; columns with no band above
 * them are identity columns (Job Title, Job Class) repeated onto every emitted
 * row. The band name is written into a synthesised `Region` column, which lets
 * the ordinary mapping pipeline take over from here unchanged.
 */
export const unpivotRegionalMatrix = (
  matrix: RawMatrix
): { headers: string[]; rows: Record<string, any>[]; regions: string[]; sourceRowCount: number } => {
  const width = matrix.reduce((max, row) => Math.max(max, row?.length ?? 0), 0);
  const bands = forwardFill(matrix[0] ?? [], width);
  const labels = Array.from({ length: width }, (_, i) => cellText(matrix[1]?.[i]));

  const identityCols: number[] = [];
  const regionCols = new Map<string, number[]>();
  const regions: string[] = [];

  for (let i = 0; i < width; i++) {
    if (labels[i] === '') continue; // unlabelled column carries nothing
    const band = bands[i];
    if (band === '') {
      identityCols.push(i);
    } else {
      if (!regionCols.has(band)) {
        regionCols.set(band, []);
        regions.push(band); // preserve left-to-right band order from the file
      }
      regionCols.get(band)!.push(i);
    }
  }

  const identityLabels = uniqueHeaders(identityCols.map((i) => labels[i]));
  const measureLabels = uniqueHeaders(
    Array.from(new Set(regions.flatMap((r) => regionCols.get(r)!.map((i) => labels[i]))))
  );
  const headers = [...identityLabels, REGION_HEADER, ...measureLabels];

  const dataRows = matrix.slice(2).filter((row) => !rowIsEmpty(row));
  const rows: Record<string, any>[] = [];

  for (const row of dataRows) {
    for (const region of regions) {
      const cols = regionCols.get(region)!;

      // A job title need not carry every region. Emitting an all-blank pair
      // here would let normalizeRawData invent a $50.00 rate for it.
      if (cols.every((i) => cellText(row?.[i]) === '')) continue;

      const obj: Record<string, any> = {};
      identityCols.forEach((col, n) => {
        obj[identityLabels[n]] = row?.[col] ?? '';
      });
      obj[REGION_HEADER] = region;
      cols.forEach((col) => {
        obj[labels[col]] = row?.[col] ?? '';
      });
      rows.push(obj);
    }
  }

  return { headers, rows, regions, sourceRowCount: dataRows.length };
};

/**
 * Entry point for both formats once the file is a raw matrix: pick the wide
 * regional path or the conventional one, then hand off to the shared preview.
 */
const matrixToPreview = (fileName: string, matrix: RawMatrix): IngestionPreviewData => {
  if (detectWideRegionalLayout(matrix)) {
    const { headers, rows, regions, sourceRowCount } = unpivotRegionalMatrix(matrix);
    return buildPreview(fileName, headers, rows, regions, sourceRowCount);
  }
  const { headers, rows } = matrixToObjectRows(matrix);
  return buildPreview(fileName, headers, rows);
};

const parseCSVFile = (file: File): Promise<IngestionPreviewData> => {
  return new Promise((resolve, reject) => {
    // header: false so the merged band row survives as row 0 of the matrix.
    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          resolve(matrixToPreview(file.name, results.data as RawMatrix));
        } catch (err) {
          reject(err);
        }
      },
      error: (error) => reject(error),
    });
  });
};

const parseExcelFile = (file: File): Promise<IngestionPreviewData> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        // header: 1 yields an array of arrays, preserving both header rows.
        const matrix = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1, defval: '' });
        resolve(matrixToPreview(file.name, matrix as RawMatrix));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
};

const pad2 = (n: number | string) => String(n).padStart(2, '0');

/**
 * Coerce a raw cell value into a "YYYY-MM-DD" date, or undefined if it is not
 * recognisably a date. Handles ISO, US slash/dash order, and Excel serial dates
 * (SheetJS hands those through as numbers when the cell is not date-formatted).
 */
export const normalizeDateValue = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  const raw = String(value).trim();
  if (!raw) return undefined;

  // Already ISO, or ISO with a time component
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // Month-only "YYYY-MM" — pin to the first of the month
  const isoMonth = raw.match(/^(\d{4})-(\d{2})$/);
  if (isoMonth) return `${isoMonth[1]}-${isoMonth[2]}-01`;

  // US order: M/D/YYYY or M-D-YYYY
  const us = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (us) return `${us[3]}-${pad2(us[1])}-${pad2(us[2])}`;

  // Excel serial date (days since 1899-12-30)
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    if (serial > 20000 && serial < 80000) {
      const ms = Date.UTC(1899, 11, 30) + serial * 86400000;
      return new Date(ms).toISOString().slice(0, 10);
    }
    return undefined;
  }

  return undefined;
};

/**
 * Extract an effective date (YYYY-MM-DD) from a file name, e.g.
 * "April_2026_Rate_Card.xlsx" -> "2026-04-01", "rate_card_2026-04-21.csv" -> "2026-04-21".
 * Falls back to today when the name carries no usable date.
 */
export const extractDateFromFileName = (fileName: string): string => {
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const monthsShort = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  const lower = fileName.toLowerCase();

  // A literal date embedded in the name wins — it is the most specific signal.
  const isoInName = lower.match(/(20\d{2})[-_.](\d{1,2})[-_.](\d{1,2})/);
  if (isoInName) return `${isoInName[1]}-${pad2(isoInName[2])}-${pad2(isoInName[3])}`;

  const usInName = lower.match(/(\d{1,2})[-_.](\d{1,2})[-_.](20\d{2})/);
  if (usInName) return `${usInName[3]}-${pad2(usInName[1])}-${pad2(usInName[2])}`;

  // Otherwise fall back to a month name plus year, pinned to the first.
  const yearMatch = lower.match(/(20\d{2})/);
  const year = yearMatch ? yearMatch[1] : new Date().getFullYear().toString();

  for (let i = 0; i < 12; i++) {
    if (lower.includes(months[i]) || lower.includes(monthsShort[i])) {
      return `${year}-${pad2(i + 1)}-01`;
    }
  }

  return new Date().toISOString().slice(0, 10);
};

/**
 * Transform raw rows + mapped columns into standard RateCardRecord items
 */
export const normalizeRawData = (
  previewData: IngestionPreviewData,
  finalMappings: ColumnMapping[],
  batchMeta: BatchMeta,
  fieldDefinitions: FieldDefinition[] = []
): RateCardRecord[] => {
  const getMappedValue = (row: Record<string, any>, targetField: TargetFieldType) => {
    const mapping = finalMappings.find(m => m.targetField === targetField);
    if (!mapping || mapping.targetField === 'ignore') return undefined;
    return row[mapping.rawHeader];
  };

  const nowStr = new Date().toISOString().split('T')[0];

  return previewData.rawRows.map((row, idx) => {
    const rawJobTitle = getMappedValue(row, 'jobTitle');
    const jobTitle = rawJobTitle ? String(rawJobTitle).trim() : `Unspecified Role #${idx + 1}`;
    
    const minRateRaw = getMappedValue(row, 'minRate');
    const maxRateRaw = getMappedValue(row, 'maxRate');

    const minRate = parseFloat(String(minRateRaw || '0').replace(/[^0-9.]/g, '')) || 50.0;
    let maxRate = parseFloat(String(maxRateRaw || '0').replace(/[^0-9.]/g, '')) || minRate * 1.35;
    
    if (maxRate < minRate) {
      maxRate = minRate * 1.25; // Guarantee logical spread if swapped or invalid
    }

    const avgRate = (minRate + maxRate) / 2;
    const rateSpread = maxRate - minRate;
    
    const category = getMappedValue(row, 'category') || 'General Staffing';
    const region = getMappedValue(row, 'region') || 'North America';
    const skillLevel = getMappedValue(row, 'skillLevel') || 'Standard';
    const laborType = getMappedValue(row, 'laborType');
    const currency = getMappedValue(row, 'currency') || 'USD';

    // Batch tags: prefer a value carried in the row's own column, fall back to
    // the batch-level value the user entered in the mapping modal.
    const effectiveDate =
      normalizeDateValue(getMappedValue(row, 'effectiveDate')) || batchMeta.effectiveDate;
    // detectedRegions preserves the left-to-right band order from the file.
    const regionOrder = previewData.detectedRegions?.indexOf(String(region));

    const rowClient = getMappedValue(row, 'client');
    const client = rowClient && String(rowClient).trim() ? String(rowClient).trim() : batchMeta.client;
    const rowReportType = getMappedValue(row, 'reportType');
    const reportType =
      rowReportType && String(rowReportType).trim() ? String(rowReportType).trim() : batchMeta.reportType;

    // Collect all custom:* mapped fields
    const customFields: Record<string, string | number> = {};
    for (const mapping of finalMappings) {
      if (typeof mapping.targetField === 'string' && mapping.targetField.startsWith('custom:')) {
        const key = mapping.targetField.replace('custom:', '');
        const rawVal = row[mapping.rawHeader];
        if (rawVal !== undefined && rawVal !== '') {
          const fieldDef = fieldDefinitions.find((f) => f.key === key);
          if (fieldDef?.fieldType === 'number') {
            const parsed = parseFloat(String(rawVal).replace(/[^0-9.-]/g, ''));
            customFields[key] = isNaN(parsed) ? String(rawVal) : parsed;
          } else {
            customFields[key] = String(rawVal);
          }
        }
      }
    }

    return {
      id: `rc-${effectiveDate}-${Date.now()}-${idx}`,
      jobTitle,
      minRate,
      maxRate,
      avgRate,
      rateSpread,
      effectiveDate,
      client,
      reportType,
      category: String(category),
      region: String(region),
      regionOrder: regionOrder !== undefined && regionOrder >= 0 ? regionOrder : undefined,
      skillLevel: String(skillLevel),
      laborType: laborType ? String(laborType) : undefined,
      currency: String(currency),
      sourceFileName: previewData.fileName,
      ingestionDate: nowStr,
      customFields: Object.keys(customFields).length > 0 ? customFields : undefined,
    };
  });
};
