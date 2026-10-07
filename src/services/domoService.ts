import {
  RateCardRecord,
  NormalizedIngestionBatch,
  ClientAlias,
  ClientDirectory,
  ClientDirectoryEntry,
  TitleAlias,
  TitleMapping,
} from '../types/rateCard';
import { countryKey } from './countryService';
import { collapseDirectoryByClientCode } from './clientMatchService';

const COLLECTION_RECORDS = 'rate_card_history';
const COLLECTION_BATCHES = 'rate_card_batches';
/** Candidate clients as Domo knows them; one document holding the whole list. */
const COLLECTION_DIRECTORY = 'rate_card_client_directory';
/** Confirmed uploaded-name to client-code pairings; one document each. */
const COLLECTION_ALIASES = 'rate_card_client_aliases';
/** Confirmed card-title to actuals-title pairings; one document each. */
const COLLECTION_TITLE_ALIASES = 'rate_card_title_aliases';
/** Uploaded title-to-standard-title mappings; one document each. */
const COLLECTION_TITLE_MAPPINGS = 'rate_card_title_mappings';
const COLLECTIONS_BASE = '/domo/datastores/v1/collections';

const LOCAL_RECORDS_KEY = 'randstad_rate_cards';
const LOCAL_BATCHES_KEY = 'randstad_batches';
const LOCAL_DIRECTORY_KEY = 'randstad_client_directory';
const LOCAL_ALIASES_KEY = 'randstad_client_aliases';
const LOCAL_TITLE_ALIASES_KEY = 'randstad_title_aliases';
const LOCAL_TITLE_MAPPINGS_KEY = 'randstad_title_mappings';

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

/**
 * Bring a stored directory entry up to the current shape.
 *
 * An earlier version stored one `country` string per entry, before candidates
 * were collapsed to one per client code and country became a list. Documents
 * written then are still in the collection, and reading them raw gave the
 * review screen an entry whose `countries` was undefined — which it
 * dereferenced, taking the whole page down.
 *
 * Migrating on read rather than discarding: unlike the rate card records, which
 * are re-ingestible from their source file, this data was assembled by hand or
 * by a dataset read and is worth keeping. Legacy country values go through
 * `countryKey` because they were stored before canonicalisation existed.
 */
const migrateDirectoryEntry = (raw: any): ClientDirectoryEntry | null => {
  if (!raw || typeof raw !== 'object') return null;

  const clientCode = String(raw.clientCode ?? '').trim();
  const accountName = String(raw.accountName ?? '').trim();
  if (!clientCode || !accountName) return null;

  let countries: string[];
  if (Array.isArray(raw.countries)) {
    countries = raw.countries.filter((c: unknown) => typeof c === 'string' && c);
  } else if (typeof raw.country === 'string' && raw.country.trim()) {
    countries = [countryKey(raw.country)];
  } else {
    countries = [];
  }

  return {
    clientCode,
    accountName,
    countries,
    hours: typeof raw.hours === 'number' ? raw.hours : undefined,
    latestMonth: typeof raw.latestMonth === 'string' ? raw.latestMonth : undefined,
  };
};

/** Migrate every entry of a stored directory, dropping any that are unusable. */
const migrateDirectory = (stored: any): ClientDirectory | null => {
  if (!stored || !Array.isArray(stored.entries)) return null;

  const entries = stored.entries
    .map(migrateDirectoryEntry)
    .filter((e: ClientDirectoryEntry | null): e is ClientDirectoryEntry => e !== null);

  const dropped = stored.entries.length - entries.length;
  if (dropped > 0) {
    console.warn(`[Domo Collections] Dropped ${dropped} unusable client directory entry/entries.`);
  }
  const upgraded = stored.entries.filter((e: any) => e && !Array.isArray(e.countries)).length;
  if (upgraded > 0) {
    console.info(
      `[Domo Collections] Upgraded ${upgraded} client directory entry/entries from the ` +
        'single-country schema.'
    );
  }

  // A directory stored before candidates were collapsed holds one entry per
  // client per country. Reshaping the field alone would leave the review screen
  // still offering four identical Xerox candidates, so the collapse runs here
  // too — it is idempotent, so an already-collapsed directory is unchanged.
  const { entries: collapsed, notes } = collapseDirectoryByClientCode(entries);
  if (collapsed.length !== entries.length) {
    console.info(
      `[Domo Collections] Collapsed ${entries.length} stored entry/entries into ${collapsed.length} client(s).`
    );
  }
  for (const note of notes) console.warn(`[Domo Collections] ${note}`);

  return {
    entries: collapsed,
    loadedAt: typeof stored.loadedAt === 'string' ? stored.loadedAt : '',
    source: stored.source === 'dataset' ? 'dataset' : 'pasted',
  };
};

export const fetchClientDirectory = async (): Promise<ClientDirectory | null> => {
  if ((await probeDomoAccess()) !== 'none') {
    try {
      const docs = await domoGet(`${COLLECTIONS_BASE}/${COLLECTION_DIRECTORY}/documents/`);
      const withIds = unwrapWithIds<ClientDirectory>(docs);
      // Newest wins if an older write left more than one document behind.
      const usable = withIds
        .filter((d) => Array.isArray((d.content as any)?.entries))
        .sort((a, b) => (b.content.loadedAt || '').localeCompare(a.content.loadedAt || ''));
      return usable.length ? migrateDirectory(usable[0].content) : null;
    } catch (error) {
      console.error('[Domo Collections] Failed to fetch the client directory:', error);
      throw error;
    }
  }

  const localData = localStorage.getItem(LOCAL_DIRECTORY_KEY);
  if (localData) {
    try {
      const migrated = migrateDirectory(JSON.parse(localData));
      if (migrated) return migrated;
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

// ---------------------------------------------------------------------------
// Title Aliases
//
// Same shape as the client aliases, keyed on client code plus normalized card
// title. Kept in its own collection rather than sharing one: the volume is an
// order of magnitude higher, and a title decision has no meaning without the
// client it was made for.
// ---------------------------------------------------------------------------

const isUsableTitleAlias = (alias: any): boolean =>
  !!alias &&
  typeof alias.cardTitleKey === 'string' &&
  alias.cardTitleKey !== '' &&
  typeof alias.clientCode === 'string' &&
  alias.clientCode !== '';

export const fetchTitleAliases = async (): Promise<TitleAlias[]> => {
  if ((await probeDomoAccess()) !== 'none') {
    try {
      const docs = await domoGet(`${COLLECTIONS_BASE}/${COLLECTION_TITLE_ALIASES}/documents/`);
      return unwrapWithIds<TitleAlias>(docs)
        .filter((d) => isUsableTitleAlias(d.content))
        .map((d) => ({ ...d.content, id: d.id }));
    } catch (error) {
      console.error('[Domo Collections] Failed to fetch title aliases:', error);
      throw error;
    }
  }

  const localData = localStorage.getItem(LOCAL_TITLE_ALIASES_KEY);
  if (localData) {
    try {
      return (JSON.parse(localData) as any[]).filter(isUsableTitleAlias) as TitleAlias[];
    } catch {
      // ignore parse errors
    }
  }
  return [];
};

/**
 * Store one title decision, replacing any earlier one for the same client and
 * card title. Returns the alias with its Domo document id.
 */
export const saveTitleAlias = async (alias: TitleAlias): Promise<TitleAlias> => {
  const aliasKey = `${alias.clientCode}||${alias.cardTitleKey}`;

  if ((await probeDomoAccess()) !== 'none') {
    const { id, ...content } = alias;

    if (id) {
      await domoPut(`${COLLECTIONS_BASE}/${COLLECTION_TITLE_ALIASES}/documents/${id}`, { content });
      return alias;
    }

    const existing = (await fetchTitleAliases()).find(
      (a) => `${a.clientCode}||${a.cardTitleKey}` === aliasKey
    );
    if (existing?.id) {
      await domoPut(`${COLLECTIONS_BASE}/${COLLECTION_TITLE_ALIASES}/documents/${existing.id}`, {
        content,
      });
      return { ...alias, id: existing.id };
    }

    const created = await domoPost(`${COLLECTIONS_BASE}/${COLLECTION_TITLE_ALIASES}/documents/`, {
      content,
    });
    return { ...alias, id: String(created?.id ?? '') };
  }

  const stored = await fetchTitleAliases();
  const localId = alias.id || `local-${aliasKey}`;
  const next = [
    { ...alias, id: localId },
    ...stored.filter((a) => `${a.clientCode}||${a.cardTitleKey}` !== aliasKey),
  ];
  localStorage.setItem(LOCAL_TITLE_ALIASES_KEY, JSON.stringify(next));
  return { ...alias, id: localId };
};

/**
 * Store several decisions at once.
 *
 * Bulk acceptance is the normal case here, not the exception — a card can carry
 * hundreds of titles and most resolve exactly. Writes run sequentially because
 * each read-back guards against creating a second decision for one title;
 * `saved` reports what actually landed rather than what was attempted.
 */
export const saveTitleAliases = async (
  aliases: TitleAlias[]
): Promise<{ saved: TitleAlias[]; failed: number; firstError?: string }> => {
  const saved: TitleAlias[] = [];
  let failed = 0;
  let firstError: string | undefined;

  for (const alias of aliases) {
    try {
      saved.push(await saveTitleAlias(alias));
    } catch (error: any) {
      failed += 1;
      firstError = firstError ?? String(error?.message ?? error);
    }
  }
  if (failed) {
    console.warn(`[Domo Collections] ${failed} title alias write(s) failed. First: ${firstError}`);
  }
  return { saved, failed, firstError };
};

/** Undo a title decision so it returns to the queue. */
export const deleteTitleAlias = async (alias: TitleAlias): Promise<void> => {
  if ((await probeDomoAccess()) !== 'none') {
    if (!alias.id) return;
    await domoDelete(`${COLLECTIONS_BASE}/${COLLECTION_TITLE_ALIASES}/documents/${alias.id}`);
    return;
  }

  const stored = await fetchTitleAliases();
  const aliasKey = `${alias.clientCode}||${alias.cardTitleKey}`;
  localStorage.setItem(
    LOCAL_TITLE_ALIASES_KEY,
    JSON.stringify(stored.filter((a) => `${a.clientCode}||${a.cardTitleKey}` !== aliasKey))
  );
};

// ---------------------------------------------------------------------------
// Title mappings
//
// Stored wholesale rather than row by row, which is the one real difference
// from the alias collections above.
//
// An alias is a decision made once, revised in place, so `saveTitleAlias` reads
// the collection back before each write to avoid creating a second decision for
// the same title. Mappings do not arrive that way: a file lands carrying the
// whole taxonomy, and the new file supersedes the old one entirely. Reusing the
// alias path would have meant one full collection read per row — several
// hundred round trips to load one file — to enforce a uniqueness rule the
// replace already guarantees.
// ---------------------------------------------------------------------------

const isUsableTitleMapping = (mapping: any): boolean =>
  !!mapping &&
  typeof mapping.uploadedTitleKey === 'string' &&
  mapping.uploadedTitleKey !== '' &&
  typeof mapping.standardTitle === 'string' &&
  mapping.standardTitle !== '';

export const fetchTitleMappings = async (): Promise<TitleMapping[]> => {
  if ((await probeDomoAccess()) !== 'none') {
    try {
      const docs = await domoGet(`${COLLECTIONS_BASE}/${COLLECTION_TITLE_MAPPINGS}/documents/`);
      return unwrapWithIds<TitleMapping>(docs)
        .filter((d) => isUsableTitleMapping(d.content))
        .map((d) => ({ ...d.content, id: d.id }));
    } catch (error) {
      console.error('[Domo Collections] Failed to fetch title mappings:', error);
      throw error;
    }
  }

  const localData = localStorage.getItem(LOCAL_TITLE_MAPPINGS_KEY);
  if (localData) {
    try {
      return (JSON.parse(localData) as any[]).filter(isUsableTitleMapping) as TitleMapping[];
    } catch {
      // ignore parse errors
    }
  }
  return [];
};

/**
 * Replace the stored mapping set with the contents of a newly uploaded file.
 *
 * The old documents go first and the new ones follow. The reverse order would
 * survive a failed write with the previous mappings intact, but it would also
 * leave two mappings for the same title if the write only partly succeeded —
 * and a taxonomy that silently disagrees with itself is worse than one that is
 * briefly empty. The file is on disk and can be uploaded again; a duplicate key
 * would quietly change what every report groups by.
 */
export const replaceTitleMappings = async (
  mappings: TitleMapping[]
): Promise<{ saved: TitleMapping[]; failed: number; firstError?: string }> => {
  if ((await probeDomoAccess()) === 'none') {
    const stored = mappings.map((m, i) => ({ ...m, id: m.id || `local-mapping-${i}` }));
    localStorage.setItem(LOCAL_TITLE_MAPPINGS_KEY, JSON.stringify(stored));
    return { saved: stored, failed: 0 };
  }

  const existing = await fetchTitleMappings();
  if (existing.length) {
    await writeInChunks(existing, (m) =>
      domoDelete(`${COLLECTIONS_BASE}/${COLLECTION_TITLE_MAPPINGS}/documents/${m.id}`)
    );
  }

  const saved: TitleMapping[] = [];
  let failed = 0;
  let firstError: string | undefined;

  for (let i = 0; i < mappings.length; i += WRITE_CONCURRENCY) {
    const slice = mappings.slice(i, i + WRITE_CONCURRENCY);
    const results = await Promise.allSettled(
      slice.map(async (mapping) => {
        const { id, ...content } = mapping;
        const created = await domoPost(
          `${COLLECTIONS_BASE}/${COLLECTION_TITLE_MAPPINGS}/documents/`,
          { content }
        );
        return { ...mapping, id: String(created?.id ?? '') };
      })
    );
    for (const result of results) {
      if (result.status === 'fulfilled') saved.push(result.value);
      else {
        failed += 1;
        firstError = firstError ?? String(result.reason?.message ?? result.reason);
      }
    }
  }

  if (failed) {
    console.warn(`[Domo Collections] ${failed} title mapping write(s) failed. First: ${firstError}`);
  }
  return { saved, failed, firstError };
};

/** Remove every stored mapping. */
export const clearTitleMappings = async (): Promise<void> => {
  if ((await probeDomoAccess()) === 'none') {
    localStorage.removeItem(LOCAL_TITLE_MAPPINGS_KEY);
    return;
  }
  const existing = await fetchTitleMappings();
  if (!existing.length) return;
  await writeInChunks(existing, (m) =>
    domoDelete(`${COLLECTIONS_BASE}/${COLLECTION_TITLE_MAPPINGS}/documents/${m.id}`)
  );
};
