import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import {
  RateCardRecord,
  NormalizedIngestionBatch,
  IngestionPreviewData,
  RateCardFilterState,
  RateCardMetricSummary,
  FieldDefinition,
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
  ingestNewBatch: (newRecords: RateCardRecord[], sourceFileName: string, effectiveMonth: string) => Promise<boolean>;
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
    selectedMonth: 'ALL',
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
    effectiveMonth: string
  ): Promise<boolean> => {
    setIsLoading(true);
    try {
      const newBatch: NormalizedIngestionBatch = {
        batchId: `batch-${Date.now()}`,
        sourceFileName,
        effectiveMonth,
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

  // Filtered dataset logic
  const filteredRateCards = useMemo(() => {
    return rateCards.filter(record => {
      const matchesSearch =
        filters.searchTerm === '' ||
        record.jobTitle.toLowerCase().includes(filters.searchTerm.toLowerCase()) ||
        (record.category && record.category.toLowerCase().includes(filters.searchTerm.toLowerCase()));

      const matchesCategory =
        filters.category === 'ALL' || record.category === filters.category;

      const matchesRegion =
        filters.region === 'ALL' || record.region === filters.region;

      const matchesMonth =
        filters.selectedMonth === 'ALL' || record.effectiveMonth === filters.selectedMonth;

      return matchesSearch && matchesCategory && matchesRegion && matchesMonth;
    });
  }, [rateCards, filters]);

  // Aggregate Metrics Computation
  const metricSummary = useMemo<RateCardMetricSummary>(() => {
    if (rateCards.length === 0) {
      return {
        totalRoles: 0,
        avgMinRate: 0,
        avgMaxRate: 0,
        avgSpread: 0,
        monthlyDriftPercentage: 0,
        totalBatchesCount: 0,
      };
    }

    const uniqueRoles = new Set(rateCards.map(r => r.jobTitle.toLowerCase())).size;
    const totalMin = rateCards.reduce((acc, r) => acc + r.minRate, 0);
    const totalMax = rateCards.reduce((acc, r) => acc + r.maxRate, 0);
    const totalSpread = rateCards.reduce((acc, r) => acc + r.rateSpread, 0);

    const avgMinRate = totalMin / rateCards.length;
    const avgMaxRate = totalMax / rateCards.length;
    const avgSpread = totalSpread / rateCards.length;

    // Estimate month-over-month rate drift between newest month and previous month
    const months = Array.from(new Set(rateCards.map(r => r.effectiveMonth))).sort().reverse();
    let monthlyDriftPercentage = 2.4; // Default positive trend baseline

    if (months.length >= 2) {
      const latestMonthCards = rateCards.filter(r => r.effectiveMonth === months[0]);
      const prevMonthCards = rateCards.filter(r => r.effectiveMonth === months[1]);

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
      totalBatchesCount: batches.length,
    };
  }, [rateCards, batches]);

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
