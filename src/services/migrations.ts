import { RateCardRecord, NormalizedIngestionBatch } from '../types/rateCard';

/**
 * Read-time migration for records persisted before the schema carried an exact
 * effective date, a client, and a report type.
 *
 * Legacy documents stored `effectiveMonth` ("YYYY-MM"). Those are pinned to the
 * first of the month so they remain sortable and comparable alongside records
 * ingested with a real date. Applied on every read path, so nothing has to be
 * re-ingested and no write-back is required.
 */

const todayISO = (): string => new Date().toISOString().slice(0, 10);

/** Coerce a legacy or partial value into a "YYYY-MM-DD" date. */
const toEffectiveDate = (raw: any): string => {
  const direct = raw?.effectiveDate;
  if (typeof direct === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;

  const legacyMonth = raw?.effectiveMonth;
  if (typeof legacyMonth === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(legacyMonth)) return legacyMonth;
    if (/^\d{4}-\d{2}$/.test(legacyMonth)) return `${legacyMonth}-01`;
  }

  // Anything else (free text, missing, malformed) falls back to today so the
  // record still renders and sorts rather than disappearing from the dashboard.
  return todayISO();
};

export const migrateRecord = (raw: any): RateCardRecord => {
  const { effectiveMonth: _legacy, ...rest } = raw ?? {};
  return {
    ...rest,
    effectiveDate: toEffectiveDate(raw),
    client: raw?.client ?? '',
    reportType: raw?.reportType ?? 'Unspecified',
  } as RateCardRecord;
};

export const migrateBatch = (raw: any): NormalizedIngestionBatch => {
  const { effectiveMonth: _legacy, ...rest } = raw ?? {};
  return {
    ...rest,
    effectiveDate: toEffectiveDate(raw),
    client: raw?.client ?? '',
    reportType: raw?.reportType ?? 'Unspecified',
    records: Array.isArray(raw?.records) ? raw.records.map(migrateRecord) : [],
  } as NormalizedIngestionBatch;
};
