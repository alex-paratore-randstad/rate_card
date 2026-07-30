import { RateCardRecord, NormalizedIngestionBatch } from '../types/rateCard';

const COLLECTION_RECORDS = 'rate_card_history';
const COLLECTION_BATCHES = 'rate_card_batches';

const COLLECTIONS_BASE = '/domo/datastores/v1/collections';

export const isDomoEnvironment = (): boolean => {
  return typeof window !== 'undefined' && !!window.domo && typeof window.domo.get === 'function';
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Unwrap Domo collection documents — each document has an `id` and `content` field. */
function unwrapDocuments<T>(docs: any[]): T[] {
  if (!Array.isArray(docs)) return [];
  return docs.map((doc) => (doc.content !== undefined ? doc.content : doc)) as T[];
}

// ---------------------------------------------------------------------------
// Rate Card Records
// ---------------------------------------------------------------------------

export const fetchHistoricalRateCards = async (): Promise<RateCardRecord[]> => {
  if (isDomoEnvironment()) {
    try {
      const docs = await window.domo.get(`${COLLECTIONS_BASE}/${COLLECTION_RECORDS}/documents/`);
      const records = unwrapDocuments<RateCardRecord>(docs);
      if (records.length > 0) return records;
    } catch (error) {
      console.warn('[Domo Collections] Error fetching rate card records, using local fallback:', error);
    }
  }

  // Local storage fallback (dev / outside Domo)
  const localData = localStorage.getItem('randstad_rate_cards');
  if (localData) {
    try {
      return JSON.parse(localData) as RateCardRecord[];
    } catch {
      // ignore parse errors
    }
  }

  return []; // Always start empty — history is built from uploads
};

export const saveRateCardsToDomo = async (
  newRecords: RateCardRecord[]
): Promise<{ success: boolean; message: string }> => {
  if (isDomoEnvironment()) {
    try {
      // POST each record as a separate Collection document
      await Promise.all(
        newRecords.map((record) =>
          window.domo.post(`${COLLECTIONS_BASE}/${COLLECTION_RECORDS}/documents/`, record)
        )
      );
      return {
        success: true,
        message: `Saved ${newRecords.length} rate card records to Domo.`,
      };
    } catch (error: any) {
      console.warn('[Domo Collections] Error saving records:', error);
      // Fall through to local storage fallback
    }
  }

  // Local storage fallback
  const existing = await fetchHistoricalRateCards();
  const updated = [...newRecords, ...existing];
  localStorage.setItem('randstad_rate_cards', JSON.stringify(updated));
  return {
    success: true,
    message: `Saved ${newRecords.length} records locally (Local Fallback Mode).`,
  };
};

// ---------------------------------------------------------------------------
// Ingestion Batches
// ---------------------------------------------------------------------------

export const fetchBatches = async (): Promise<NormalizedIngestionBatch[]> => {
  if (isDomoEnvironment()) {
    try {
      const docs = await window.domo.get(`${COLLECTIONS_BASE}/${COLLECTION_BATCHES}/documents/`);
      const batches = unwrapDocuments<NormalizedIngestionBatch>(docs);
      if (batches.length > 0) return batches;
    } catch (error) {
      console.warn('[Domo Collections] Error fetching batches, using local fallback:', error);
    }
  }

  const localData = localStorage.getItem('randstad_batches');
  if (localData) {
    try {
      return JSON.parse(localData) as NormalizedIngestionBatch[];
    } catch {
      // ignore
    }
  }

  return []; // No mock data — start clean
};

export const saveBatchToDomo = async (
  batch: NormalizedIngestionBatch
): Promise<void> => {
  if (isDomoEnvironment()) {
    try {
      await window.domo.post(`${COLLECTIONS_BASE}/${COLLECTION_BATCHES}/documents/`, batch);
      return;
    } catch (error) {
      console.warn('[Domo Collections] Error saving batch:', error);
    }
  }

  // Local storage fallback
  const existing = await fetchBatches();
  localStorage.setItem('randstad_batches', JSON.stringify([batch, ...existing]));
};
