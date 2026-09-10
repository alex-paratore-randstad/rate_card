import {
  AssignmentActualRow,
  ClientDirectoryRow,
  DATASET_ALIASES,
  DatasetAlias,
  EXPECTED_COLUMNS,
  NUMERIC_COLUMNS,
} from '../types/domoDatasets';
import { ClientDirectoryEntry } from '../types/rateCard';
import { probeDomoAccess } from './domoService';

/**
 * Reading Domo datasets mapped into this app.
 *
 * Datasets are a different channel from the collections in domoService: they
 * are read-only, addressed by the alias declared in `datasetsMapping`, and
 * served at `/data/v1/<alias>` as a plain JSON array of row objects. That is
 * the pattern the fte_tool app already uses successfully in this instance, and
 * it is deliberately followed rather than the documented SDK call, because
 * domo.js is not served here.
 *
 * A mapping only takes effect on publish, so a dataset that reads as absent in
 * a running app usually means the manifest changed without a republish.
 */

const DATA_BASE = '/data/v1';

/** Where a seeded dataset lives for local development. */
const localKey = (alias: string) => `randstad_dataset_${alias}`;

export interface DatasetReadResult<T> {
  rows: T[];
  /** Where the rows came from. A seeded read must never look like a Domo read. */
  source: 'domo' | 'local-seed';
  /** Columns the dataset returned that the app did not expect, and vice versa. */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Shape checking
// ---------------------------------------------------------------------------

/**
 * Compare the first row against the columns the app expects.
 *
 * Worth doing on every read: the manifest's field list is what determines the
 * columns, changing it needs a republish, and a missing column surfaces as
 * `undefined` rather than an error. Silent `undefined` in a rate column becomes
 * a plausible-looking wrong number, which is the failure mode hardest to catch
 * downstream.
 */
const checkRowShape = (alias: DatasetAlias, rows: Record<string, unknown>[]): string[] => {
  if (!rows.length) return [];

  const expected = EXPECTED_COLUMNS[alias];
  const actual = Object.keys(rows[0]);

  const missing = expected.filter((c) => !actual.includes(c));
  const unexpected = actual.filter((c) => !expected.includes(c));

  const warnings: string[] = [];
  if (missing.length) {
    warnings.push(
      `${alias} is missing ${missing.length} expected column(s): ${missing.join(', ')}. ` +
        `Check the manifest's fields list, and that the app was republished after it changed.`
    );
  }
  if (unexpected.length) {
    warnings.push(
      `${alias} returned ${unexpected.length} column(s) the app does not model: ${unexpected.join(', ')}.`
    );
  }
  for (const w of warnings) console.warn(`[Domo Dataset] ${w}`);
  return warnings;
};

/**
 * Coerce declared numeric columns to numbers.
 *
 * Domo can return a numeric column as a string depending on the dataset's
 * column type, and `"55.00" * 2` is not an error in JavaScript — it is 110,
 * while `"55.00" + 2` is "55.002". Coercing once here means no consumer has to
 * remember which it got. An empty or non-numeric value becomes null rather than
 * NaN, so "no value" stays distinguishable from "zero".
 */
const coerceNumerics = <T>(alias: DatasetAlias, rows: Record<string, unknown>[]): T[] => {
  const numeric = NUMERIC_COLUMNS[alias];
  return rows.map((row) => {
    const out: Record<string, unknown> = { ...row };
    for (const col of numeric) {
      const raw = out[col];
      if (raw === null || raw === undefined || raw === '') {
        out[col] = null;
        continue;
      }
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, ''));
      out[col] = Number.isFinite(n) ? n : null;
    }
    return out as T;
  });
};

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Read one mapped dataset in full.
 *
 * There is no paging here on purpose. The manifest's per-dataset fields list
 * already narrows the payload by column, and whether `/data/v1` honours a
 * `limit` parameter in this instance is unverified — a `limit` that is silently
 * ignored would turn a paged read into the same full read repeated once per
 * page. `probeQuerySupport` answers that question against the live endpoint;
 * until it does, a full read is the only behaviour that cannot be wrong.
 */
export const fetchDataset = async <T>(alias: DatasetAlias): Promise<DatasetReadResult<T>> => {
  const access = await probeDomoAccess();

  if (access !== 'none') {
    const started = performance.now();
    const res = await fetch(`${DATA_BASE}/${alias}`, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(
        `Reading dataset "${alias}" failed: HTTP ${res.status}. ` +
          (res.status === 404
            ? 'The alias is not mapped in this published version — a datasetsMapping change needs a republish.'
            : detail.slice(0, 200))
      );
    }

    const payload = await res.json();
    if (!Array.isArray(payload)) {
      throw new Error(
        `Dataset "${alias}" returned ${typeof payload}, not an array of rows. ` +
          'The read path assumes /data/v1 returns a plain JSON array.'
      );
    }

    const rows = payload as Record<string, unknown>[];
    // Row count and elapsed time are logged because the size of the actuals
    // dataset is the open question that decides whether this stays a full read.
    console.info(
      `[Domo Dataset] ${alias}: ${rows.length} rows in ${Math.round(performance.now() - started)}ms`
    );

    return {
      rows: coerceNumerics<T>(alias, rows),
      source: 'domo',
      warnings: checkRowShape(alias, rows),
    };
  }

  // Local development. /data/v1 does not exist outside the Domo host, so there
  // is nothing to fall back to except rows someone seeded deliberately.
  const seeded = localStorage.getItem(localKey(alias));
  if (!seeded) {
    throw new Error(
      `Dataset "${alias}" cannot be read outside Domo. ` +
        'Seed rows with seedLocalDataset() to develop against it, or publish the app.'
    );
  }

  const rows = JSON.parse(seeded) as Record<string, unknown>[];
  console.info(`[Domo Dataset] ${alias}: ${rows.length} seeded row(s) from local storage.`);
  return {
    rows: coerceNumerics<T>(alias, rows),
    source: 'local-seed',
    warnings: checkRowShape(alias, rows),
  };
};

/**
 * Whether `/data/v1` honours a `limit` parameter in this instance.
 *
 * Asks for one row and compares against the unrestricted count. Call it once
 * from a published app before building anything on paging: if `limit` is
 * ignored the endpoint returns everything, and a paged reader would multiply
 * the payload rather than divide it.
 */
export const probeQuerySupport = async (
  alias: DatasetAlias
): Promise<{ limitHonoured: boolean; detail: string }> => {
  if ((await probeDomoAccess()) === 'none') {
    return { limitHonoured: false, detail: 'Not running inside Domo; nothing to probe.' };
  }

  const read = async (url: string) => {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    return Array.isArray(body) ? body.length : -1;
  };

  try {
    const [limited, full] = await Promise.all([
      read(`${DATA_BASE}/${alias}?limit=1`),
      read(`${DATA_BASE}/${alias}`),
    ]);

    if (limited === 1 && full !== 1) {
      return { limitHonoured: true, detail: `limit=1 returned 1 row of ${full}; paging is available.` };
    }
    if (limited === full) {
      return {
        limitHonoured: false,
        detail: `limit=1 returned all ${full} rows; the parameter is ignored. Do not page.`,
      };
    }
    return { limitHonoured: false, detail: `Inconclusive: limit=1 returned ${limited}, full returned ${full}.` };
  } catch (error: any) {
    return { limitHonoured: false, detail: `Probe failed: ${error?.message || 'unknown error'}` };
  }
};

/** Seed rows for local development. Never used by a published app. */
export const seedLocalDataset = (alias: DatasetAlias, rows: Record<string, unknown>[]): void => {
  localStorage.setItem(localKey(alias), JSON.stringify(rows));
  console.info(`[Domo Dataset] Seeded ${rows.length} local row(s) for ${alias}.`);
};

export const clearLocalDataset = (alias: DatasetAlias): void =>
  localStorage.removeItem(localKey(alias));

// ---------------------------------------------------------------------------
// Typed readers
// ---------------------------------------------------------------------------

/**
 * The client directory as the matcher consumes it.
 *
 * Maps dataset columns onto the app's own `ClientDirectoryEntry`, which is the
 * only place those column names need to appear — the matcher and the review
 * screen stay unaware of what Domo calls things. Rows missing a client code or
 * account name are dropped: an entry without both cannot be matched against or
 * joined on, and would only show up as a blank candidate.
 */
export const fetchClientDirectoryFromDataset = async (): Promise<{
  entries: ClientDirectoryEntry[];
  source: DatasetReadResult<unknown>['source'];
  skipped: number;
}> => {
  const { rows, source } = await fetchDataset<ClientDirectoryRow>(DATASET_ALIASES.clientDirectory);

  const entries: ClientDirectoryEntry[] = [];
  let skipped = 0;

  for (const row of rows) {
    const clientCode = (row.rsr_client_code || '').trim();
    const accountName = (row.account_name || '').trim();
    if (!clientCode || !accountName) {
      skipped += 1;
      continue;
    }
    entries.push({
      clientCode,
      accountName,
      country: row.rsr_country || undefined,
      hours: typeof row.hours_sum === 'number' ? row.hours_sum : undefined,
      latestMonth: row.month_max || undefined,
    });
  }

  if (skipped) {
    console.warn(`[Domo Dataset] Skipped ${skipped} directory row(s) missing a code or name.`);
  }
  return { entries, source, skipped };
};

/** Assignment-level actuals. The reports join these against the rate card. */
export const fetchAssignmentActuals = async (): Promise<DatasetReadResult<AssignmentActualRow>> =>
  fetchDataset<AssignmentActualRow>(DATASET_ALIASES.assignmentActuals);
