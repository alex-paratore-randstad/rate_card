import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { ColumnMapping, IngestionPreviewData, TargetFieldType, RateCardRecord } from '../types/rateCard';

const HEADER_ALIASES: Record<TargetFieldType, string[]> = {
  jobTitle: ['job title', 'title', 'role', 'position', 'job', 'designation', 'job_title', 'job family'],
  minRate: ['min rate', 'pay min', 'minimum rate', 'min', 'min_rate', 'min bill rate', 'min pay rate', 'minimum pay', 'rate (min)'],
  maxRate: ['max rate', 'pay max', 'maximum rate', 'max', 'max_rate', 'max bill rate', 'max pay rate', 'maximum pay', 'rate (max)'],
  effectiveMonth: ['effective month', 'month', 'date', 'effective date', 'period', 'report month', 'month year', 'as of date'],
  category: ['category', 'domain', 'practice', 'department', 'vertical', 'business unit'],
  region: ['region', 'location', 'market', 'country', 'geography', 'site', 'office'],
  skillLevel: ['skill level', 'level', 'seniority', 'tier', 'grade', 'experience level'],
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

const parseCSVFile = (file: File): Promise<IngestionPreviewData> => {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const rawRows = results.data as Record<string, any>[];
          const headers = results.meta.fields || (rawRows.length > 0 ? Object.keys(rawRows[0]) : []);
          
          const mappings = headers.map(header => {
            const sampleValues = rawRows.slice(0, 5).map(row => String(row[header] ?? ''));
            return detectColumnMapping(header, sampleValues);
          });

          const validationErrors: string[] = [];
          if (!mappings.some(m => m.targetField === 'jobTitle')) {
            validationErrors.push('Warning: Could not automatically detect a "Job Title / Role" column.');
          }
          if (!mappings.some(m => m.targetField === 'minRate')) {
            validationErrors.push('Warning: Could not automatically detect a "Minimum Rate" column.');
          }
          if (!mappings.some(m => m.targetField === 'maxRate')) {
            validationErrors.push('Warning: Could not automatically detect a "Maximum Rate" column.');
          }

          // Auto detect month from file name or date column
          const detectedMonth = extractMonthFromFileName(file.name) || new Date().toISOString().slice(0, 7);

          resolve({
            fileName: file.name,
            headers,
            rawRows,
            mappings,
            detectedMonth,
            validationErrors,
          });
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
        const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, { defval: '' });
        
        const headers = rawRows.length > 0 ? Object.keys(rawRows[0]) : [];
        const mappings = headers.map(header => {
          const sampleValues = rawRows.slice(0, 5).map(row => String(row[header] ?? ''));
          return detectColumnMapping(header, sampleValues);
        });

        const validationErrors: string[] = [];
        if (!mappings.some(m => m.targetField === 'jobTitle')) {
          validationErrors.push('Warning: Could not automatically detect a "Job Title / Role" column.');
        }
        if (!mappings.some(m => m.targetField === 'minRate')) {
          validationErrors.push('Warning: Could not automatically detect a "Minimum Rate" column.');
        }

        const detectedMonth = extractMonthFromFileName(file.name) || new Date().toISOString().slice(0, 7);

        resolve({
          fileName: file.name,
          headers,
          rawRows,
          mappings,
          detectedMonth,
          validationErrors,
        });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
};

/**
 * Extract Month (YYYY-MM) from string (e.g. "April_2026_Rate_Card.xlsx" -> "2026-04")
 */
export const extractMonthFromFileName = (fileName: string): string => {
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const monthsShort = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  
  const lower = fileName.toLowerCase();
  
  // Find year
  const yearMatch = lower.match(/(20\d{2})/);
  const year = yearMatch ? yearMatch[1] : new Date().getFullYear().toString();

  for (let i = 0; i < 12; i++) {
    if (lower.includes(months[i]) || lower.includes(monthsShort[i])) {
      const monthNum = String(i + 1).padStart(2, '0');
      return `${year}-${monthNum}`;
    }
  }
  return `${year}-04`; // Default to current month
};

/**
 * Transform raw rows + mapped columns into standard RateCardRecord items
 */
export const normalizeRawData = (
  previewData: IngestionPreviewData,
  finalMappings: ColumnMapping[],
  effectiveMonth: string
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
    const currency = getMappedValue(row, 'currency') || 'USD';

    return {
      id: `rc-${effectiveMonth}-${Date.now()}-${idx}`,
      jobTitle,
      minRate,
      maxRate,
      avgRate,
      rateSpread,
      effectiveMonth,
      category: String(category),
      region: String(region),
      skillLevel: String(skillLevel),
      currency: String(currency),
      sourceFileName: previewData.fileName,
      ingestionDate: nowStr,
    };
  });
};
