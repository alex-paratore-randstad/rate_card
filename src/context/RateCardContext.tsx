import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import {
  RateCardRecord,
  NormalizedIngestionBatch,
  IngestionPreviewData,
  RateCardFilterState,
  RateCardMetricSummary,
  FieldDefinition,
  BatchMeta,
} from '../types/rateCard';
import { fetchHistoricalRateCards, saveRateCardsToDomo, fetchBatches, saveBatchToDomo } from '../services/domoService';
import { fetchFieldDefinitions, addFieldDefinition, removeFieldDefinition } from '../services/fieldService';

interface RateCardContextType {
  rateCards: RateCardRecord[];
  batches: NormalizedIngestionBatch[];
  activeTab: 'dashboard' | 'ingest' | 'collection';
  setActiveTab: (tab: 'dashboard' | 'ingest' | 'collection') => void;
  previewData: IngestionPreviewData | null;
  setPreviewData: (data: IngestionPreviewData | null) => void;
  filters: RateCardFilterState;
  setFilters: React.Dispatch<React.SetStateAction<RateCardFilterState>>;
  metricSummary: RateCardMetricSummary;
  filteredRateCards: RateCardRecord[];
  /** Records narrowed to the selected client only — the scope every dashboard metric uses. */
  clientScopedRateCards: RateCardRecord[];
  availableClients: string[];
  ingestNewBatch: (newRecords: RateCardRecord[], sourceFileName: string, batchMeta: BatchMeta) => Promise<boolean>;
  refreshDataset: () => Promise<void>;
  isLoading: boolean;
  notificationMessage: { type: 'success' | 'error' | 'info'; text: string } | null;
  clearNotification: () => void;
  fieldDefinitions: FieldDefinition[];
  addField: (field: FieldDefinition) => Promise<void>;
  removeField: (key: string) => Promise<void>;
}

const RateCardContext = createContext<RateCardContextType | undefined>(undefined);

export const RateCardProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [rateCards, setRateCards] = useState<RateCardRecord[]>([]);
  const [batches, setBatches] = useState<NormalizedIngestionBatch[]>([]);
  const [fieldDefinitions, setFieldDefinitions] = useState<FieldDefinition[]>([]);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'ingest' | 'collection'>('dashboard');
  const [previewData, setPreviewData] = useState<IngestionPreviewData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [notificationMessage, setNotificationMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const [filters, setFilters] = useState<RateCardFilterState>({
    searchTerm: '',
    category: 'ALL',
    region: 'ALL',
    selectedDate: 'ALL',
    client: 'ALL',
  });

  const refreshDataset = async () => {
    setIsLoading(true);
    try {
      const [records, batchList, fields] = await Promise.all([
        fetchHistoricalRateCards(),
        fetchBatches(),
        fetchFieldDefinitions(),
      ]);
      setRateCards(records);
      setBatches(batchList);
      setFieldDefinitions(fields);
    } catch (err) {
      console.error('Failed to load rate card data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const addField = async (field: FieldDefinition) => {
    const updated = await addFieldDefinition(field, fieldDefinitions);
    setFieldDefinitions(updated);
  };

  const removeField = async (key: string) => {
    const updated = await removeFieldDefinition(key, fieldDefinitions);
    setFieldDefinitions(updated);
  };

  useEffect(() => {
    refreshDataset();
  }, []);

  const clearNotification = () => setNotificationMessage(null);

  const ingestNewBatch = async (
    newRecords: RateCardRecord[],
    sourceFileName: string,
    batchMeta: BatchMeta
  ): Promise<boolean> => {
    setIsLoading(true);
    try {
      const newBatch: NormalizedIngestionBatch = {
        batchId: `batch-${Date.now()}`,
        sourceFileName,
        effectiveDate: batchMeta.effectiveDate,
        client: batchMeta.client,
        reportType: batchMeta.reportType,
        recordCount: newRecords.length,
        records: newRecords,
        status: 'ingested',
        ingestionTimestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      };

      const [result] = await Promise.all([
        saveRateCardsToDomo(newRecords),
        saveBatchToDomo(newBatch),
      ]);

      setBatches(prev => [newBatch, ...prev]);
      setRateCards(prev => [...newRecords, ...prev]);
      setPreviewData(null);
      setActiveTab('dashboard');

      setNotificationMessage({
        type: 'success',
        text: result.message,
      });

      return true;
    } catch (err: any) {
      setNotificationMessage({
        type: 'error',
        text: `Ingestion failed: ${err.message || 'Unknown error'}`,
      });
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  // Every distinct client present in the collection. Records migrated from the
  // pre-client schema carry an empty string; they are grouped under one entry.
  const availableClients = useMemo(() => {
    return Array.from(new Set(rateCards.map(r => r.client || ''))).sort();
  }, [rateCards]);

  // Client scope is applied before anything else. Rate cards from different
  // clients are not comparable, so averaging across them produces a number that
  // describes no actual client — every dashboard metric reads from this set.
  const clientScopedRateCards = useMemo(() => {
    if (filters.client === 'ALL') return rateCards;
    return rateCards.filter(record => (record.client || '') === filters.client);
  }, [rateCards, filters.client]);

  // Table-level filtering, layered on top of the client scope
  const filteredRateCards = useMemo(() => {
    return clientScopedRateCards.filter(record => {
      const matchesSearch =
        filters.searchTerm === '' ||
        record.jobTitle.toLowerCase().includes(filters.searchTerm.toLowerCase()) ||
        (record.category && record.category.toLowerCase().includes(filters.searchTerm.toLowerCase()));

      const matchesCategory =
        filters.category === 'ALL' || record.category === filters.category;

      const matchesRegion =
        filters.region === 'ALL' || record.region === filters.region;

      const matchesDate =
        filters.selectedDate === 'ALL' || record.effectiveDate === filters.selectedDate;

      return matchesSearch && matchesCategory && matchesRegion && matchesDate;
    });
  }, [clientScopedRateCards, filters]);

  // Aggregate Metrics Computation — scoped to the selected client, so the
  // headline figures always describe one client rather than a blend of several.
  const metricSummary = useMemo<RateCardMetricSummary>(() => {
    const scoped = clientScopedRateCards;

    if (scoped.length === 0) {
      return {
        totalRoles: 0,
        avgMinRate: 0,
        avgMaxRate: 0,
        avgSpread: 0,
        monthlyDriftPercentage: 0,
        totalBatchesCount: 0,
      };
    }

    const uniqueRoles = new Set(scoped.map(r => r.jobTitle.toLowerCase())).size;
    const totalMin = scoped.reduce((acc, r) => acc + r.minRate, 0);
    const totalMax = scoped.reduce((acc, r) => acc + r.maxRate, 0);
    const totalSpread = scoped.reduce((acc, r) => acc + r.rateSpread, 0);

    const avgMinRate = totalMin / scoped.length;
    const avgMaxRate = totalMax / scoped.length;
    const avgSpread = totalSpread / scoped.length;

    // Rate drift between the two most recent effective dates. Keyed on the full
    // date so two reports landing in the same month compare as distinct periods.
    const dates = Array.from(new Set(scoped.map(r => r.effectiveDate))).sort().reverse();
    let monthlyDriftPercentage = 0; // No prior period means no measurable drift

    if (dates.length >= 2) {
      const latestMonthCards = scoped.filter(r => r.effectiveDate === dates[0]);
      const prevMonthCards = scoped.filter(r => r.effectiveDate === dates[1]);

      const latestAvg = latestMonthCards.reduce((acc, r) => acc + r.avgRate, 0) / (latestMonthCards.length || 1);
      const prevAvg = prevMonthCards.reduce((acc, r) => acc + r.avgRate, 0) / (prevMonthCards.length || 1);

      if (prevAvg > 0) {
        monthlyDriftPercentage = ((latestAvg - prevAvg) / prevAvg) * 100;
      }
    }

    return {
      totalRoles: uniqueRoles,
      avgMinRate,
      avgMaxRate,
      avgSpread,
      monthlyDriftPercentage,
      totalBatchesCount:
        filters.client === 'ALL'
          ? batches.length
          : batches.filter(b => (b.client || '') === filters.client).length,
    };
  }, [clientScopedRateCards, batches, filters.client]);

  return (
    <RateCardContext.Provider
      value={{
        rateCards,
        batches,
        activeTab,
        setActiveTab,
        previewData,
        setPreviewData,
        filters,
        setFilters,
        metricSummary,
        filteredRateCards,
        clientScopedRateCards,
        availableClients,
        ingestNewBatch,
        refreshDataset,
        isLoading,
        notificationMessage,
        clearNotification,
        fieldDefinitions,
        addField,
        removeField,
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
