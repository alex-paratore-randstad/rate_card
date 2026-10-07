import * as XLSX from 'xlsx';
import {
  MappingColumn,
  MappingCoverage,
  MappingTargetField,
  RateCardRecord,
  TitleMapping,
  TitleMappingPreview,
} from '../types/rateCard';
import { normalizeJobTitle } from './titleService';

/**
 * Reading the uploaded title mapping file.
 *
 * The file answers one question — what is this uploaded job title really
 * called? — and the app has an answer for it already in `normalizeJobTitle`.
 * Every key built here goes through that same function, so a mapping keyed on
 * "Sr. Software Eng. II" finds a card row spelled "Senior Software Engineer 2"
 * without the file having to anticipate the spelling. Building keys any other
 * way would create a second, quietly different notion of title identity.
 */

/**
 * Header text that identifies each column.
 *
 * The uploaded-title aliases are deliberately the narrower list. "Title" alone
 * is ambiguous in a two-title file, so it resolves to the uploaded side only
 * when nothing claims that side more strongly — which is handled by scoring
 * below rather than by the alias list.
 */
const MAPPING_ALIASES: Record<Exclude<MappingTargetField, 'ignore'>, string[]> = {
  uploadedTitle: [
    'uploaded title',
    'card title',
    'source title',
    'original title',
    'raw title',
    'client title',
    'job title',
    'job titles',
    'title',
    'from',
  ],
  standardTitle: [
    'standard title',
    'standardised title',
    'standardized title',
    'canonical title',
    'mapped title',
    'normalized title',
    'normalised title',
    'target title',
    'standard job title',
    'standard',
    'mapping',
    'maps to',
    'to',
  ],
  family: ['family', 'job family', 'category', 'job category', 'function', 'discipline', 'group'],
  level: ['level', 'job level', 'seniority', 'grade', 'band', 'tier', 'rank'],
};

const clean = (header: string): string =>
  header.toLowerCase().replace(/[-–—_()]/g, ' ').replace(/\s+/g, ' ').trim();

/** Score one header against one field. 1 is an exact alias, 0 is no signal. */
const scoreHeader = (header: string, field: Exclude<MappingTargetField, 'ignore'>): number => {
  const core = clean(header);
  if (!core) return 0;
  let best = 0;
  for (const alias of MAPPING_ALIASES[field]) {
    if (core === alias) return 1;
    // A containment hit is weaker, and weaker still for a short alias like
    // "to", which turns up inside unrelated words.
    if (core.includes(alias)) best = Math.max(best, alias.length >= 5 ? 0.8 : 0.5);
  }
  return best;
};

/**
 * Assign headers to fields, best claim first.
 *
 * Scored globally rather than header by header because the two title columns
 * compete for the same words: a file headed "Job Title" and "Standard Title"
 * has both columns matching a `uploadedTitle` alias, and taking each header in
 * isolation would map both to the uploaded side and leave the mapping with no
 * target. Resolving the strongest claim first, then removing that field and
 * that header from contention, gets this file right.
 */
export const detectMappingColumns = (
  headers: string[],
  rows: Record<string, any>[]
): MappingColumn[] => {
  const fields: Exclude<MappingTargetField, 'ignore'>[] = [
    'uploadedTitle',
    'standardTitle',
    'family',
    'level',
  ];

  const claims: { header: string; field: MappingTargetField; score: number }[] = [];
  for (const header of headers) {
    for (const field of fields) {
      const score = scoreHeader(header, field);
      if (score > 0) claims.push({ header, field, score });
    }
  }
  claims.sort((a, b) => b.score - a.score);

  const assigned = new Map<string, { field: MappingTargetField; score: number }>();
  const taken = new Set<MappingTargetField>();
  for (const claim of claims) {
    if (assigned.has(claim.header) || taken.has(claim.field)) continue;
    assigned.set(claim.header, { field: claim.field, score: claim.score });
    taken.add(claim.field);
  }

  // A two-column file with no recognisable headers is still obviously a
  // mapping: first column from, second column to. Only applied when nothing
  // was detected at all, so it never overrides a real header.
  if (assigned.size === 0 && headers.length >= 2) {
    assigned.set(headers[0], { field: 'uploadedTitle', score: 0.3 });
    assigned.set(headers[1], { field: 'standardTitle', score: 0.3 });
  }

  return headers.map((header) => ({
    rawHeader: header,
    targetField: assigned.get(header)?.field ?? 'ignore',
    confidence: assigned.get(header)?.score ?? 0,
    sampleValues: rows
      .slice(0, 5)
      .map((r) => String(r[header] ?? '').trim())
      .filter(Boolean)
      .slice(0, 3),
  }));
};

/** Turn a sheet matrix into headers plus row objects, skipping blank leads. */
const layout = (matrix: any[][]): { headers: string[]; rows: Record<string, any>[] } => {
  const firstFilled = matrix.findIndex((row) =>
    row.some((cell) => String(cell ?? '').trim() !== '')
  );
  if (firstFilled === -1) return { headers: [], rows: [] };

  const headers = matrix[firstFilled].map((h, i) => String(h ?? '').trim() || `Column ${i + 1}`);
  const rows = matrix
    .slice(firstFilled + 1)
    .filter((row) => row.some((cell) => String(cell ?? '').trim() !== ''))
    .map((row) => {
      const obj: Record<string, any> = {};
      headers.forEach((h, i) => {
        obj[h] = row[i] ?? '';
      });
      return obj;
    });
  return { headers, rows };
};

/**
 * Read an uploaded mapping file.
 *
 * The tab with the most rows wins, and the others are named in the preview.
 * A mapping file is usually a single sheet, but a workbook carrying a "Notes"
 * or "Instructions" tab is common enough that silently reading sheet one would
 * sometimes read the wrong thing without saying so.
 */
export const readTitleMappingFile = (file: File): Promise<TitleMappingPreview> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const workbook = XLSX.read(new Uint8Array(e.target?.result as ArrayBuffer), {
          type: 'array',
        });

        const sheets = workbook.SheetNames.map((name) => {
          const matrix = XLSX.utils.sheet_to_json<any[]>(workbook.Sheets[name], {
            header: 1,
            defval: '',
          });
          return { name, ...layout(matrix as any[][]) };
        }).filter((s) => s.rows.length > 0 && s.headers.length > 0);

        if (!sheets.length) {
          reject(new Error('No readable rows were found in that file.'));
          return;
        }

        const chosen = sheets.reduce((a, b) => (b.rows.length > a.rows.length ? b : a));
        resolve({
          fileName: file.name,
          sheetName: chosen.name,
          otherSheets: sheets.filter((s) => s.name !== chosen.name).map((s) => s.name),
          headers: chosen.headers,
          rows: chosen.rows,
          columns: detectMappingColumns(chosen.headers, chosen.rows),
        });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });

/**
 * Build the mappings a confirmed preview describes.
 *
 * Rows missing either title are dropped and counted rather than stored blank —
 * a mapping with no target silently removes a title from the taxonomy, which
 * looks identical to never having mapped it. Duplicate uploaded titles keep the
 * first and are counted too, since a title cannot have two standard forms and
 * picking the last would depend on row order.
 */
export const buildTitleMappings = (
  preview: TitleMappingPreview,
  columns: MappingColumn[],
  uploadedAt: string
): { mappings: TitleMapping[]; skipped: number; duplicates: string[] } => {
  const columnFor = (field: MappingTargetField): string | undefined =>
    columns.find((c) => c.targetField === field)?.rawHeader;

  const uploadedCol = columnFor('uploadedTitle');
  const standardCol = columnFor('standardTitle');
  const familyCol = columnFor('family');
  const levelCol = columnFor('level');

  if (!uploadedCol || !standardCol) {
    return { mappings: [], skipped: preview.rows.length, duplicates: [] };
  }

  const mappings: TitleMapping[] = [];
  const seen = new Set<string>();
  const duplicates: string[] = [];
  let skipped = 0;

  preview.rows.forEach((row, index) => {
    const uploadedTitle = String(row[uploadedCol] ?? '').trim();
    const standardTitle = String(row[standardCol] ?? '').trim();
    const uploadedTitleKey = normalizeJobTitle(uploadedTitle);

    if (!uploadedTitle || !standardTitle || !uploadedTitleKey) {
      skipped += 1;
      return;
    }
    if (seen.has(uploadedTitleKey)) {
      duplicates.push(uploadedTitle);
      return;
    }
    seen.add(uploadedTitleKey);

    mappings.push({
      id: `mapping-${index}`,
      uploadedTitle,
      uploadedTitleKey,
      standardTitle,
      standardTitleKey: normalizeJobTitle(standardTitle),
      family: familyCol ? String(row[familyCol] ?? '').trim() || undefined : undefined,
      level: levelCol ? String(row[levelCol] ?? '').trim() || undefined : undefined,
      sourceFileName: preview.fileName,
      uploadedAt,
    });
  });

  return { mappings, skipped, duplicates };
};

/** The standard title for an uploaded one, or null when it is unmapped. */
export const standardTitleFor = (
  uploadedTitle: string,
  mappings: TitleMapping[]
): TitleMapping | null => {
  const key = normalizeJobTitle(uploadedTitle);
  if (!key) return null;
  return mappings.find((m) => m.uploadedTitleKey === key) ?? null;
};

/**
 * How far the mapping file covers the titles actually ingested.
 *
 * Counted in records rather than distinct titles so the gap is weighted by how
 * much of the card it leaves out: twenty unmapped titles carrying one row each
 * matter less than one carrying two hundred. `unusedMappings` is the other
 * direction — rows in the file matching nothing we hold, which is how a
 * taxonomy built for a different account shows up.
 */
export const mappingCoverage = (
  cards: RateCardRecord[],
  mappings: TitleMapping[]
): MappingCoverage => {
  const counts = new Map<string, { title: string; count: number }>();
  for (const card of cards) {
    const title = (card.jobTitle || '').trim();
    if (!title) continue;
    const key = normalizeJobTitle(title);
    if (!key) continue;
    const entry = counts.get(key) ?? { title, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }

  const byKey = new Map(mappings.map((m) => [m.uploadedTitleKey, m]));
  const mapped: MappingCoverage['mapped'] = [];
  const unmapped: MappingCoverage['unmapped'] = [];
  const usedKeys = new Set<string>();

  for (const [key, { title, count }] of counts) {
    const mapping = byKey.get(key);
    if (mapping) {
      usedKeys.add(key);
      mapped.push({
        uploadedTitle: title,
        standardTitle: mapping.standardTitle,
        recordCount: count,
      });
    } else {
      unmapped.push({ uploadedTitle: title, recordCount: count });
    }
  }

  // Heaviest first — the order the gaps are worth closing in.
  mapped.sort((a, b) => b.recordCount - a.recordCount);
  unmapped.sort((a, b) => b.recordCount - a.recordCount);

  return {
    mapped,
    unmapped,
    unusedMappings: mappings.filter((m) => !usedKeys.has(m.uploadedTitleKey)).length,
  };
};
