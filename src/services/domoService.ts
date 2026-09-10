import {
  RateCardRecord,
  NormalizedIngestionBatch,
  ClientAlias,
  ClientDirectory,
} from '../types/rateCard';

const COLLECTION_RECORDS = 'rate_card_history';
const COLLECTION_BATCHES = 'rate_card_batches';
/** Candidate clients as Domo knows them; one document holding the whole list. */
const COLLECTION_DIRECTORY = 'rate_card_client_directory';
/** Confirmed uploaded-name to client-code pairings; one document each. */
const COLLECTION_ALIASES = 'rate_card_client_aliases';
const COLLECTIONS_BASE = '/domo/datastores/v1/collections';

const LOCAL_RECORDS_KEY = 'randstad_rate_cards';
const LOCAL_BATCHES_KEY = 'randstad_batches';
const LOCAL_DIRECTORY_KEY = 'randstad_client_directory';
const LOCAL_ALIASES_KEY = 'randstad_client_aliases';

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

/** PUT through whichever channel is available. */
const domoPut = async (url: string, body: any): Promise<any> => {
  const access = await probeDomoAccess();
  if (access === 'sdk') return window.domo.put(url, body);
  if (access === 'proxy') {
    return jsonOrThrow(
      await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      }),
      'PUT'
    );
  }
  throw new Error('Not running inside Domo');
};

/** DELETE through whichever channel is available. */
const domoDelete = async (url: string): Promise<any> => {
  const access = await probeDomoAccess();
  if (access === 'sdk') return window.domo.delete(url);
  if (access === 'proxy') {
    return jsonOrThrow(
      await fetch(url, { method: 'DELETE', credentials: 'same-origin' }),
      'DELETE'
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
 * Like `unwrapDocuments`, but keeps the document id. An alias decision has to
 * be revisable in place, and that needs the id Domo assigned on creation.
 */
function unwrapWithIds<T>(docs: any[]): { id: string; content: T }[] {
  if (!Array.isArray(docs)) return [];
  return docs
    .filter((doc) => doc && doc.content !== undefined)
    .map((doc) => ({ id: String(doc.id), content: doc.content as T }));
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

// ---------------------------------------------------------------------------
// Client Directory
//
// The candidate list the matcher scores against. Read and written wholesale, so
// it lives in a single document rather than one per account — that keeps the
// refresh a single write instead of a delete-then-insert over hundreds of rows.
// ---------------------------------------------------------------------------

export const fetchClientDirectory = async (): Promise<ClientDirectory | null> => {
  if ((await probeDomoAccess()) !== 'none') {
    try {
      const docs = await domoGet(`${COLLECTIONS_BASE}/${COLLECTION_DIRECTORY}/documents/`);
      const withIds = unwrapWithIds<ClientDirectory>(docs);
      // Newest wins if an older write left more than one document behind.
      const usable = withIds
        .filter((d) => Array.isArray(d.content?.entries))
        .sort((a, b) => (b.content.loadedAt || '').localeCompare(a.content.loadedAt || ''));
      return usable.length ? usable[0].content : null;
    } catch (error) {
      console.error('[Domo Collections] Failed to fetch the client directory:', error);
      throw error;
    }
  }

  const localData = localStorage.getItem(LOCAL_DIRECTORY_KEY);
  if (localData) {
    try {
      const parsed = JSON.parse(localData) as ClientDirectory;
      if (Array.isArray(parsed?.entries)) return parsed;
    } catch {
      // ignore parse errors
    }
  }
  return null;
};

export const saveClientDirectory = async (directory: ClientDirectory): Promise<void> => {
  if ((await probeDomoAccess()) !== 'none') {
    const docs = await domoGet(`${COLLECTIONS_BASE}/${COLLECTION_DIRECTORY}/documents/`);
    const existing = unwrapWithIds<ClientDirectory>(docs);

    if (existing.length) {
      // Replace in place so the directory does not accumulate stale copies.
      await domoPut(`${COLLECTIONS_BASE}/${COLLECTION_DIRECTORY}/documents/${existing[0].id}`, {
        content: directory,
      });
      // Any duplicates from an earlier run would shadow the update on read.
      for (const stale of existing.slice(1)) {
        try {
          await domoDelete(`${COLLECTIONS_BASE}/${COLLECTION_DIRECTORY}/documents/${stale.id}`);
        } catch (error) {
          console.warn('[Domo Collections] Could not remove a stale directory document:', error);
        }
      }
      return;
    }

    await domoPost(`${COLLECTIONS_BASE}/${COLLECTION_DIRECTORY}/documents/`, { content: directory });
    return;
  }

  localStorage.setItem(LOCAL_DIRECTORY_KEY, JSON.stringify(directory));
};

// ---------------------------------------------------------------------------
// Client Aliases
//
// One document per confirmed pairing. Written one at a time as a reviewer works
// through the list, and revised in place when a decision changes.
// ---------------------------------------------------------------------------

const isUsableAlias = (alias: any): boolean =>
  !!alias && typeof alias.normalizedKey === 'string' && alias.normalizedKey !== '';

export const fetchClientAliases = async (): Promise<ClientAlias[]> => {
  if ((await probeDomoAccess()) !== 'none') {
    try {
      const docs = await domoGet(`${COLLECTIONS_BASE}/${COLLECTION_ALIASES}/documents/`);
      return unwrapWithIds<ClientAlias>(docs)
        .filter((d) => isUsableAlias(d.content))
        // The document id is the identity, so a stored id is overwritten with
        // the real one rather than trusted.
        .map((d) => ({ ...d.content, id: d.id }));
    } catch (error) {
      console.error('[Domo Collections] Failed to fetch client aliases:', error);
      throw error;
    }
  }

  const localData = localStorage.getItem(LOCAL_ALIASES_KEY);
  if (localData) {
    try {
      return (JSON.parse(localData) as any[]).filter(isUsableAlias) as ClientAlias[];
    } catch {
      // ignore parse errors
    }
  }
  return [];
};

/**
 * Store one decision, replacing any earlier decision for the same uploaded
 * name. Returns the alias with the id Domo assigned, so the caller's state
 * holds something that can be revised without a refetch.
 */
export const saveClientAlias = async (alias: ClientAlias): Promise<ClientAlias> => {
  if ((await probeDomoAccess()) !== 'none') {
    const { id, ...content } = alias;

    if (id) {
      await domoPut(`${COLLECTIONS_BASE}/${COLLECTION_ALIASES}/documents/${id}`, { content });
      return alias;
    }

    // No id yet, but the same client may already have been decided in an
    // earlier session. Overwrite that document instead of adding a second
    // decision for one client, which would make the lookup order-dependent.
    const existing = (await fetchClientAliases()).find(
      (a) => a.normalizedKey === alias.normalizedKey
    );
    if (existing?.id) {
      await domoPut(`${COLLECTIONS_BASE}/${COLLECTION_ALIASES}/documents/${existing.id}`, {
        content,
      });
      return { ...alias, id: existing.id };
    }

    const created = await domoPost(`${COLLECTIONS_BASE}/${COLLECTION_ALIASES}/documents/`, {
      content,
    });
    return { ...alias, id: String(created?.id ?? '') };
  }

  const stored = await fetchClientAliases();
  const localId = alias.id || `local-${alias.normalizedKey}`;
  const next = [
    { ...alias, id: localId },
    ...stored.filter((a) => a.normalizedKey !== alias.normalizedKey),
  ];
  localStorage.setItem(LOCAL_ALIASES_KEY, JSON.stringify(next));
  return { ...alias, id: localId };
};

/** Undo a decision so the client returns to the review list. */
export const deleteClientAlias = async (alias: ClientAlias): Promise<void> => {
  if ((await probeDomoAccess()) !== 'none') {
    if (!alias.id) return;
    await domoDelete(`${COLLECTIONS_BASE}/${COLLECTION_ALIASES}/documents/${alias.id}`);
    return;
  }

  const stored = await fetchClientAliases();
  localStorage.setItem(
    LOCAL_ALIASES_KEY,
    JSON.stringify(stored.filter((a) => a.normalizedKey !== alias.normalizedKey))
  );
};
