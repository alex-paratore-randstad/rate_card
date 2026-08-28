import { RateCardRecord, NormalizedIngestionBatch } from '../types/rateCard';

const COLLECTION_RECORDS = 'rate_card_history';
const COLLECTION_BATCHES = 'rate_card_batches';
const COLLECTIONS_BASE = '/domo/datastores/v1/collections';

const LOCAL_RECORDS_KEY = 'randstad_rate_cards';
const LOCAL_BATCHES_KEY = 'randstad_batches';

/** How many collection writes to keep in flight at once. */
const WRITE_CONCURRENCY = 25;

/**
 * How this app can reach Domo.
 *
 * 'sdk'   — domo.js loaded and window.domo is usable.
 * 'proxy' — domo.js is absent, but the app container still proxies same-origin
 *           /domo/... requests, so plain fetch reaches the collection.
 * 'none'  — neither works; this is local development.
 *
 * The SDK script is not always served inside a published card, so relying on
 * window.domo alone reported a hosted app as local development and quietly sent
 * every save to browser storage.
 */
export type DomoAccess = 'sdk' | 'proxy' | 'none';

let cachedAccess: DomoAccess | null = null;
let probeInFlight: Promise<DomoAccess> | null = null;

/** Synchronous check for the SDK only; prefer probeDomoAccess. */
export const hasDomoSdk = (): boolean =>
  typeof window !== 'undefined' && !!window.domo && typeof window.domo.get === 'function';

export const probeDomoAccess = async (): Promise<DomoAccess> => {
  if (cachedAccess) return cachedAccess;
  if (probeInFlight) return probeInFlight;

  probeInFlight = (async (): Promise<DomoAccess> => {
    if (hasDomoSdk()) {
      cachedAccess = 'sdk';
    } else {
      try {
        const res = await fetch(`${COLLECTIONS_BASE}/${COLLECTION_RECORDS}/documents/`, {
          headers: { Accept: 'application/json' },
          credentials: 'same-origin',
        });
        cachedAccess = res.ok ? 'proxy' : 'none';
        if (!res.ok) {
          console.warn(`[Domo] Collection probe returned HTTP ${res.status}; treating as local.`);
        }
      } catch (error) {
        console.warn('[Domo] Collection probe failed; treating as local development.', error);
        cachedAccess = 'none';
      }
    }
    console.info(`[Domo] Access mode: ${cachedAccess}`);
    return cachedAccess;
  })();

  return probeInFlight;
};

const jsonOrThrow = async (res: Response, what: string) => {
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${what} failed: HTTP ${res.status}${detail ? ` — ${detail.slice(0, 300)}` : ''}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
};

/** GET through whichever channel is available. */
const domoGet = async (url: string): Promise<any> => {
  const access = await probeDomoAccess();
  if (access === 'sdk') return window.domo.get(url);
  if (access === 'proxy') {
    return jsonOrThrow(
      await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' }),
      'GET'
    );
  }
  throw new Error('Not running inside Domo');
};

/** POST through whichever channel is available. */
const domoPost = async (url: string, body: any): Promise<any> => {
  const access = await probeDomoAccess();
  if (access === 'sdk') return window.domo.post(url, body);
  if (access === 'proxy') {
    return jsonOrThrow(
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      }),
      'POST'
    );
  }
  throw new Error('Not running inside Domo');
};

export interface SaveResult {
  success: boolean;
  savedCount: number;
  attemptedCount: number;
  /** Where the data actually landed — never claim Domo when it was the browser. */
  target: 'domo' | 'local';
  message: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Unwrap Domo collection documents — each has an `id` and a `content` field. */
function unwrapDocuments<T>(docs: any[]): T[] {
  if (!Array.isArray(docs)) return [];
  return docs.map((doc) => (doc.content !== undefined ? doc.content : doc)) as T[];
}

/**
 * Run `fn` over `items` with a bounded number in flight, returning how many
 * succeeded. Unlike a bare `Promise.all`, one rejection does not discard the
 * rest — a partial write is reported honestly rather than as total failure.
 */
async function writeInChunks<T>(
  items: T[],
  fn: (item: T) => Promise<unknown>,
  size = WRITE_CONCURRENCY
): Promise<{ saved: number; firstError?: string }> {
  let saved = 0;
  let firstError: string | undefined;

  for (let i = 0; i < items.length; i += size) {
    const slice = items.slice(i, i + size);
    const results = await Promise.allSettled(slice.map(fn));
    saved += results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected'
    );
    if (failed.length) {
      console.warn(`[Domo Collections] ${failed.length} write(s) failed in this chunk`, failed[0].reason);
      firstError = firstError ?? String(failed[0].reason?.message ?? failed[0].reason);
    }
  }
  return { saved, firstError };
}

/** A stored document from an older schema has no rateYear and cannot be shown. */
const isCurrentSchema = (record: any): boolean =>
  !!record && typeof record.rateYear === 'string' && record.rateYear !== '';

// ---------------------------------------------------------------------------
// Rate Card Records
// ---------------------------------------------------------------------------

export const fetchHistoricalRateCards = async (): Promise<RateCardRecord[]> => {
  if ((await probeDomoAccess()) !== 'none') {
    try {
      const docs = await domoGet(`${COLLECTIONS_BASE}/${COLLECTION_RECORDS}/documents/`);
      const all = unwrapDocuments<any>(docs);
      const current = all.filter(isCurrentSchema);
      if (current.length < all.length) {
        console.warn(
          `[Domo Collections] Skipped ${all.length - current.length} record(s) from an older schema.`
        );
      }
      return current as RateCardRecord[];
    } catch (error) {
      console.error('[Domo Collections] Failed to fetch rate card records:', error);
      throw error; // Surface it; do not silently fall back to browser storage.
    }
  }

  // Local development only — window.domo does not exist outside the Domo host.
  const localData = localStorage.getItem(LOCAL_RECORDS_KEY);
  if (localData) {
    try {
      return (JSON.parse(localData) as any[]).filter(isCurrentSchema) as RateCardRecord[];
    } catch {
      // ignore parse errors
    }
  }
  return [];
};

export const saveRateCardsToDomo = async (
  newRecords: RateCardRecord[],
  batchId: string
): Promise<SaveResult> => {
  const attemptedCount = newRecords.length;

  if ((await probeDomoAccess()) !== 'none') {
    // The collections API stores documents as { id, content }, and a write must
    // send that shape. Posting the bare record is rejected, which is why reads
    // succeeded while every write failed.
    const { saved: savedCount, firstError } = await writeInChunks(newRecords, (record) =>
      domoPost(`${COLLECTIONS_BASE}/${COLLECTION_RECORDS}/documents/`, { content: record })
    );

    // Read back so the confirmation reflects what Domo holds, not what was sent.
    let confirmed = savedCount;
    try {
      const docs = await domoGet(`${COLLECTIONS_BASE}/${COLLECTION_RECORDS}/documents/`);
      confirmed = unwrapDocuments<any>(docs).filter((r) => r?.batchId === batchId).length;
    } catch (error) {
      console.warn('[Domo Collections] Could not verify the write by read-back:', error);
    }

    if (confirmed === 0) {
      return {
        success: false,
        savedCount: 0,
        attemptedCount,
        target: 'domo',
        message: `Failed to save any of ${attemptedCount} records to Domo. Nothing was stored.${
          firstError ? ` First error: ${firstError}` : ''
        }`,
      };
    }
    if (confirmed < attemptedCount) {
      return {
        success: false,
        savedCount: confirmed,
        attemptedCount,
        target: 'domo',
        message: `Partial save: only ${confirmed} of ${attemptedCount} records reached Domo.`,
      };
    }
    return {
      success: true,
      savedCount: confirmed,
      attemptedCount,
      target: 'domo',
      message: `Saved ${confirmed} records to the Domo collection.`,
    };
  }

  // Outside Domo. This is developer convenience, and the message says so — it
  // must never read as a successful save to Domo.
  const existing = await fetchHistoricalRateCards();
  localStorage.setItem(LOCAL_RECORDS_KEY, JSON.stringify([...newRecords, ...existing]));
  return {
    success: true,
    savedCount: attemptedCount,
    attemptedCount,
    target: 'local',
    message: `Stored ${attemptedCount} records in local development storage. Nothing was sent to Domo — publish the app to write to the collection.`,
  };
};

// ---------------------------------------------------------------------------
// Ingestion Batches
// ---------------------------------------------------------------------------

export const fetchBatches = async (): Promise<NormalizedIngestionBatch[]> => {
  if ((await probeDomoAccess()) !== 'none') {
    try {
      const docs = await domoGet(`${COLLECTIONS_BASE}/${COLLECTION_BATCHES}/documents/`);
      return unwrapDocuments<any>(docs).filter(
        (b) => b && Array.isArray(b.rateYears)
      ) as NormalizedIngestionBatch[];
    } catch (error) {
      console.error('[Domo Collections] Failed to fetch batches:', error);
      throw error;
    }
  }

  const localData = localStorage.getItem(LOCAL_BATCHES_KEY);
  if (localData) {
    try {
      return (JSON.parse(localData) as any[]).filter(
        (b) => b && Array.isArray(b.rateYears)
      ) as NormalizedIngestionBatch[];
    } catch {
      // ignore
    }
  }
  return [];
};

export const saveBatchToDomo = async (batch: NormalizedIngestionBatch): Promise<void> => {
  if ((await probeDomoAccess()) !== 'none') {
    try {
      await domoPost(`${COLLECTIONS_BASE}/${COLLECTION_BATCHES}/documents/`, { content: batch });
    } catch (error) {
      // The audit entry failing is worth knowing about, but the records are the
      // payload — do not fail the whole ingestion over the log line.
      console.error('[Domo Collections] Failed to save the batch audit entry:', error);
    }
    return;
  }

  const existing = await fetchBatches();
  localStorage.setItem(LOCAL_BATCHES_KEY, JSON.stringify([batch, ...existing]));
};
