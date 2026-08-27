import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import {
  RateCardRecord,
  NormalizedIngestionBatch,
  IngestionPreviewData,
  RateCardFilterState,
} from '../types/rateCard';
import {
  fetchHistoricalRateCards,
  saveRateCardsToDomo,
  fetchBatches,
  saveBatchToDomo,
} from '../services/domoService';

interface RateCardContextType {
  /** Every record ever ingested, including superseded uploads. */
  rateCards: RateCardRecord[];
  /** The latest upload of each rate year — what every report reads. */
  currentRateCards: RateCardRecord[];
  /** currentRateCards narrowed by the client and country scope. */
  scopedRateCards: RateCardRecord[];
  batches: NormalizedIngestionBatch[];
  activeTab: 'dashboard' | 'ingest' | 'collection';
  setActiveTab: (tab: 'dashboard' | 'ingest' | 'collection') => void;
  previewData: IngestionPreviewData | null;
  setPreviewData: (data: IngestionPreviewData | null) => void;
  filters: RateCardFilterState;
  setFilters: React.Dispatch<React.SetStateAction<RateCardFilterState>>;
  availableClients: string[];
  availableCountries: string[];
  ingestNewBatch: (
    records: RateCardRecord[],
    sourceFileName: string,
    batchId: string,
    uploadedAt: string,
    rateYears: string[]
  ) => Promise<boolean>;
  refreshDataset: () => Promise<void>;
  isLoading: boolean;
  notificationMessage: { type: 'success' | 'error' | 'info'; text: string } | null;
  clearNotification: () => void;
}

const RateCardContext = createContext<RateCardContextType | undefined>(undefined);

export const RateCardProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [rateCards, setRateCards] = useState<RateCardRecord[]>([]);
  const [batches, setBatches] = useState<NormalizedIngestionBatch[]>([]);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'ingest' | 'collection'>('dashboard');
  const [previewData, setPreviewData] = useState<IngestionPreviewData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [notificationMessage, setNotificationMessage] = useState<
    { type: 'success' | 'error' | 'info'; text: string } | null
  >(null);

  const [filters, setFilters] = useState<RateCardFilterState>({ client: 'ALL', country: 'ALL' });

  const refreshDataset = async () => {
    setIsLoading(true);
    try {
      const [records, batchList] = await Promise.all([fetchHistoricalRateCards(), fetchBatches()]);
      setRateCards(records);
      setBatches(batchList);
    } catch (err: any) {
      console.error('Failed to load rate card data:', err);
      setNotificationMessage({
        type: 'error',
        text: `Could not load data from the Domo collection: ${err?.message || 'unknown error'}`,
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshDataset();
  }, []);

  const clearNotification = () => setNotificationMessage(null);

  const ingestNewBatch = async (
    records: RateCardRecord[],
    sourceFileName: string,
    batchId: string,
    uploadedAt: string,
    rateYears: string[]
  ): Promise<boolean> => {
    setIsLoading(true);
    try {
      const result = await saveRateCardsToDomo(records, batchId);

      const batch: NormalizedIngestionBatch = {
        batchId,
        sourceFileName,
        rateYears,
        // Per-tab overrides mean one upload can cover several markets.
        clients: Array.from(new Set(records.map((r) => r.client || '').filter(Boolean))).sort(),
        countries: Array.from(new Set(records.map((r) => r.country || '').filter(Boolean))).sort(),
        recordCount: records.length,
        // Status reflects what actually happened, rather than assuming success.
        savedCount: result.savedCount,
        status:
          result.savedCount === 0
            ? 'failed'
            : result.savedCount < result.attemptedCount
            ? 'partial'
            : 'ingested',
        target: result.target,
        statusMessage: result.message,
        uploadedAt,
      };
      await saveBatchToDomo(batch);

      setBatches((prev) => [batch, ...prev]);
      if (result.savedCount > 0) {
        setRateCards((prev) => [...records, ...prev]);
        setPreviewData(null);
        setActiveTab('dashboard');
      }

      setNotificationMessage({
        // A local-only save is information, not success — it did not reach Domo.
        type: !result.success ? 'error' : result.target === 'local' ? 'info' : 'success',
        text: result.message,
      });
      return result.success;
    } catch (err: any) {
      setNotificationMessage({
        type: 'error',
        text: `Ingestion failed: ${err?.message || 'Unknown error'}`,
      });
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * The newest upload of each rate year, per client and country. Re-uploading a
   * year supersedes the previous one for reporting, while the older records stay
   * in `rateCards` so the collection viewer can show how that year changed.
   *
   * The key includes client and country deliberately. Keyed on year alone, a
   * file covering only the US would supersede every other market's records for
   * that year and silently drop them from the report.
   */
  const supersedeKey = (r: RateCardRecord) =>
    `${r.rateYear}||${r.client || ''}||${r.country || ''}`;

  const currentRateCards = useMemo(() => {
    const newest = new Map<string, { batchId: string; uploadedAt: string }>();
    for (const r of rateCards) {
      const key = supersedeKey(r);
      const seen = newest.get(key);
      if (!seen || r.uploadedAt > seen.uploadedAt) {
        newest.set(key, { batchId: r.batchId, uploadedAt: r.uploadedAt });
      }
    }
    return rateCards.filter((r) => newest.get(supersedeKey(r))?.batchId === r.batchId);
  }, [rateCards]);

  const availableClients = useMemo(
    () => Array.from(new Set(currentRateCards.map((r) => r.client || ''))).sort(),
    [currentRateCards]
  );

  const availableCountries = useMemo(
    () => Array.from(new Set(currentRateCards.map((r) => r.country || ''))).sort(),
    [currentRateCards]
  );

  /**
   * Rates from different clients or different countries are not comparable, so
   * the scope is applied before any variance is computed.
   */
  const scopedRateCards = useMemo(
    () =>
      currentRateCards.filter(
        (r) =>
          (filters.client === 'ALL' || (r.client || '') === filters.client) &&
          (filters.country === 'ALL' || (r.country || '') === filters.country)
      ),
    [currentRateCards, filters]
  );

  return (
    <RateCardContext.Provider
      value={{
        rateCards,
        currentRateCards,
        scopedRateCards,
        batches,
        activeTab,
        setActiveTab,
        previewData,
        setPreviewData,
        filters,
        setFilters,
        availableClients,
        availableCountries,
        ingestNewBatch,
        refreshDataset,
        isLoading,
        notificationMessage,
        clearNotification,
      }}
    >
      {children}
    </RateCardContext.Provider>
  );
};

export const useRateCard = () => {
  const context = useContext(RateCardContext);
  if (!context) {
    throw new Error('useRateCard must be used within a RateCardProvider');
  }
  return context;
};
