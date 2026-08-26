import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import {
  ColumnMapping,
  IngestionPreviewData,
  TargetFieldType,
  RateCardRecord,
  BatchMeta,
} from '../types/rateCard';

/** Synthesised column the year unpivot writes the rate year into. */
const YEAR_HEADER = 'Rate Year';

const HEADER_ALIASES: Record<TargetFieldType, string[]> = {
  jobTitle: ['job title', 'job titles', 'title', 'role', 'position', 'job', 'designation', 'job_title'],
  laborType: ['labor type', 'labour type', 'worker type', 'worker category', 'employment type', 'work type', 'labor_type', 'labor classification', 'resource type', 'job class'],
  minRate: ['min pay', 'min rate', 'minimum pay', 'minimum rate', 'min', 'min_rate', 'min bill rate', 'min pay rate', 'pay min'],
  maxRate: ['max pay', 'max rate', 'maximum pay', 'maximum rate', 'max', 'max_rate', 'max bill rate', 'max pay rate', 'pay max'],
  rateYear: ['rate year', 'year'],
  client: ['client', 'client name', 'customer', 'customer name', 'account', 'account name', 'company', 'msp', 'program'],
  country: ['country', 'nation', 'geo', 'geography', 'locale'],
  ignore: [],
};

/**
 * Descriptive words that carry no mapping signal. Stripping them lets
 * "Min Pay - National Average (2025)" match the plain "min pay" alias instead of
 * relying on a fuzzy substring hit.
 */
const NOISE_WORDS = /\b(national|average|avg|suggested|bill|rate card|usd|per hour|hourly)\b/g;

const YEAR_PATTERN = /\b(19\d{2}|20\d{2})\b/;

/** Header text with the year and descriptive noise removed. */
const headerCore = (header: string): string =>
  header
    .toLowerCase()
    .replace(/\((19\d{2}|20\d{2})\)/g, ' ')
    .replace(YEAR_PATTERN, ' ')
    .replace(NOISE_WORDS, ' ')
    .replace(/[-–—_()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Auto-detect the matching target field for a raw header string.
 */
export const detectColumnMapping = (header: string, sampleValues: string[]): ColumnMapping => {
  const core = headerCore(header);

  let bestMatch: TargetFieldType = 'ignore';
  let highestConfidence = 0;

  for (const [targetField, aliases] of Object.entries(HEADER_ALIASES)) {
    if (targetField === 'ignore') continue;

    for (const alias of aliases) {
      if (core === alias) {
        bestMatch = targetField as TargetFieldType;
        highestConfidence = 1.0;
        break;
      } else if (core.includes(alias) || alias.includes(core)) {
        if (0.8 > highestConfidence) {
          bestMatch = targetField as TargetFieldType;
          highestConfidence = 0.8;
        }
      }
    }
    if (highestConfidence === 1.0) break;
  }

  // Fallback: a numeric column whose name mentions min or max is a rate column.
  if (bestMatch === 'ignore') {
    const isNumericSample = sampleValues.some((v) => !isNaN(parseFloat(v)) && isFinite(Number(v)));
    if (isNumericSample && core.includes('min')) {
      bestMatch = 'minRate';
      highestConfidence = 0.7;
    } else if (isNumericSample && core.includes('max')) {
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
 * Parse an uploaded file (CSV or XLSX) into raw rows and column mappings.
 */
export const parseRateCardFile = async (file: File): Promise<IngestionPreviewData> => {
  const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
  return isExcel ? parseExcelFile(file) : parseCSVFile(file);
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
 * Shared preview assembly for both file formats, so CSV and XLSX cannot drift.
 */
const buildPreview = (
  fileName: string,
  headers: string[],
  rawRows: Record<string, any>[],
  detectedYears?: string[],
  sourceRowCount?: number
): IngestionPreviewData => {
  const mappings = headers.map((header) => {
    const sampleValues = rawRows.slice(0, 5).map((row) => String(row[header] ?? ''));
    return detectColumnMapping(header, sampleValues);
  });

  const validationErrors: string[] = [];
  if (!mappings.some((m) => m.targetField === 'jobTitle')) {
    validationErrors.push('Warning: Could not automatically detect a "Job Title" column.');
  }
  if (!mappings.some((m) => m.targetField === 'minRate')) {
    validationErrors.push('Warning: Could not automatically detect a "Min Pay" column.');
  }
  if (!mappings.some((m) => m.targetField === 'maxRate')) {
    validationErrors.push('Warning: Could not automatically detect a "Max Pay" column.');
  }

  return {
    fileName,
    headers,
    rawRows,
    mappings,
    detectedYears,
    detectedClient: firstMappedValue(rawRows, mappings, 'client'),
    detectedCountry: firstMappedValue(rawRows, mappings, 'country'),
    sourceRowCount,
    validationErrors,
  };
};

// ---------------------------------------------------------------------------
// Raw matrix handling
//
// Files are read as an array of arrays first, because the rate year lives in
// the column header rather than in a date column. Reading straight to object
// rows would leave the two years fused into one set of columns.
// ---------------------------------------------------------------------------

type RawMatrix = any[][];

const cellText = (value: unknown): string => String(value ?? '').trim();

const rowIsEmpty = (row: any[]): boolean => !row || row.every((c) => cellText(c) === '');

/** Which measure a header describes, ignoring the year and any noise words. */
const measureOf = (header: string): 'min' | 'max' | null => {
  const core = headerCore(header);
  if (/\bmin\b|minimum/.test(core)) return 'min';
  if (/\bmax\b|maximum/.test(core)) return 'max';
  return null;
};

const yearOf = (header: string): string | null => {
  const match = header.match(YEAR_PATTERN);
  return match ? match[1] : null;
};

/**
 * A year-column layout puts the rate year in the header: at least two headers
 * carry a four-digit year, and at least one of those years has both a min and a
 * max column. Both conditions are required, so an ordinary file that happens to
 * mention a year in one header does not trip it.
 */
export const detectYearColumnLayout = (matrix: RawMatrix): boolean => {
  if (!matrix || matrix.length < 2) return false;

  const headers = (matrix[0] ?? []).map(cellText).filter(Boolean);
  const withYear = headers.filter((h) => yearOf(h));
  if (withYear.length < 2) return false;

  const byYear = new Map<string, Set<'min' | 'max'>>();
  for (const header of withYear) {
    const year = yearOf(header)!;
    const measure = measureOf(header);
    if (!measure) continue;
    const set = byYear.get(year) ?? new Set<'min' | 'max'>();
    set.add(measure);
    byYear.set(year, set);
  }

  return Array.from(byYear.values()).some((set) => set.has('min') && set.has('max'));
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
 * Turn year columns into long rows — one per source row per rate year.
 *
 * Columns carrying a year belong to that year; columns without one are identity
 * columns (Job Titles, Labor Type) repeated onto every emitted row. The year is
 * written into a synthesised `Rate Year` column so the ordinary mapping
 * pipeline takes over from here unchanged. Any number of years is supported.
 */
export const unpivotYearColumns = (
  matrix: RawMatrix
): { headers: string[]; rows: Record<string, any>[]; years: string[]; sourceRowCount: number } => {
  const width = matrix.reduce((max, row) => Math.max(max, row?.length ?? 0), 0);
  const rawHeaders = Array.from({ length: width }, (_, i) => cellText(matrix[0]?.[i]));

  const identityCols: number[] = [];
  const yearCols = new Map<string, { min?: number; max?: number }>();
  const years: string[] = [];

  rawHeaders.forEach((header, i) => {
    if (header === '') return;
    const year = yearOf(header);
    const measure = year ? measureOf(header) : null;

    if (!year || !measure) {
      identityCols.push(i);
      return;
    }
    if (!yearCols.has(year)) {
      yearCols.set(year, {});
      years.push(year); // preserve left-to-right order from the file
    }
    yearCols.get(year)![measure] = i;
  });

  const identityLabels = uniqueHeaders(identityCols.map((i) => rawHeaders[i]));
  const headers = [...identityLabels, YEAR_HEADER, 'Min Pay', 'Max Pay'];

  const dataRows = matrix.slice(1).filter((row) => !rowIsEmpty(row));
  const rows: Record<string, any>[] = [];

  for (const row of dataRows) {
    for (const year of years) {
      const cols = yearCols.get(year)!;
      const minVal = cols.min !== undefined ? row?.[cols.min] : '';
      const maxVal = cols.max !== undefined ? row?.[cols.max] : '';

      // A role need not be priced in every year. Emitting an all-blank pair
      // would let normalizeRawData invent a $50.00 rate for it.
      if (cellText(minVal) === '' && cellText(maxVal) === '') continue;

      const obj: Record<string, any> = {};
      identityCols.forEach((col, n) => {
        obj[identityLabels[n]] = row?.[col] ?? '';
      });
      obj[YEAR_HEADER] = year;
      obj['Min Pay'] = minVal;
      obj['Max Pay'] = maxVal;
      rows.push(obj);
    }
  }

  return { headers, rows, years, sourceRowCount: dataRows.length };
};

/** Pick the year-column path or the conventional one, then build the preview. */
const matrixToPreview = (fileName: string, matrix: RawMatrix): IngestionPreviewData => {
  if (detectYearColumnLayout(matrix)) {
    const { headers, rows, years, sourceRowCount } = unpivotYearColumns(matrix);
    return buildPreview(fileName, headers, rows, years, sourceRowCount);
  }
  const { headers, rows } = matrixToObjectRows(matrix);
  return buildPreview(fileName, headers, rows);
};

const parseCSVFile = (file: File): Promise<IngestionPreviewData> => {
  return new Promise((resolve, reject) => {
    // header: false so the year-bearing header row survives as row 0.
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
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
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

/**
 * Transform raw rows plus final mappings into RateCardRecord items.
 */
export const normalizeRawData = (
  previewData: IngestionPreviewData,
  finalMappings: ColumnMapping[],
  batchMeta: BatchMeta,
  batchId: string,
  uploadedAt: string
): RateCardRecord[] => {
  const getMappedValue = (row: Record<string, any>, targetField: TargetFieldType) => {
    const mapping = finalMappings.find((m) => m.targetField === targetField);
    if (!mapping || mapping.targetField === 'ignore') return undefined;
    return row[mapping.rawHeader];
  };

  const fallbackYear = String(new Date().getFullYear());

  return previewData.rawRows.map((row, idx) => {
    const rawJobTitle = getMappedValue(row, 'jobTitle');
    const jobTitle = rawJobTitle ? String(rawJobTitle).trim() : `Unspecified Role #${idx + 1}`;

    const minRate = parseFloat(String(getMappedValue(row, 'minRate') ?? '').replace(/[^0-9.]/g, '')) || 0;
    const maxRate = parseFloat(String(getMappedValue(row, 'maxRate') ?? '').replace(/[^0-9.]/g, '')) || 0;

    const avgRate = (minRate + maxRate) / 2;
    const rateSpread = maxRate - minRate;

    const rawYear = getMappedValue(row, 'rateYear');
    const rateYear = rawYear ? String(rawYear).trim() : fallbackYear;

    const rawLaborType = getMappedValue(row, 'laborType');
    const laborType = rawLaborType ? String(rawLaborType).trim() : undefined;

    // Prefer a value carried in the row's own column, fall back to the
    // batch-level value the user entered in the mapping modal.
    const rowClient = getMappedValue(row, 'client');
    const client = rowClient && String(rowClient).trim() ? String(rowClient).trim() : batchMeta.client;
    const rowCountry = getMappedValue(row, 'country');
    const country = rowCountry && String(rowCountry).trim() ? String(rowCountry).trim() : batchMeta.country;

    return {
      id: `rc-${rateYear}-${batchId}-${idx}`,
      batchId,
      jobTitle,
      laborType,
      minRate,
      maxRate,
      avgRate,
      rateSpread,
      rateYear,
      client,
      country,
      sourceFileName: previewData.fileName,
      uploadedAt,
    };
  });
};
