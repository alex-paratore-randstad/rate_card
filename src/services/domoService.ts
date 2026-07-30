import { RateCardRecord } from '../types/rateCard';
import { INITIAL_MOCK_RATE_CARDS } from './mockData';

const DEFAULT_DATASET_ALIAS = 'rate_card_history';

export const isDomoEnvironment = (): boolean => {
  return typeof window !== 'undefined' && !!window.domo && typeof window.domo.get === 'function';
};

/**
 * Fetch historical rate card collection from Domo dataset or fallback to local storage / mock data
 */
export const fetchHistoricalRateCards = async (
  datasetAlias: string = DEFAULT_DATASET_ALIAS
): Promise<RateCardRecord[]> => {
  if (isDomoEnvironment()) {
    try {
      console.log(`[Domo API] Querying dataset alias: ${datasetAlias}`);
      const data = await window.domo.get(`/data/v2/${datasetAlias}?limit=1000`);
      if (Array.isArray(data) && data.length > 0) {
        return data as RateCardRecord[];
      }
    } catch (error) {
      console.warn('[Domo API] Exception fetching from Domo container, falling back to local dataset:', error);
    }
  }

  // Fallback mode: check localStorage or return mock data
  const localData = localStorage.getItem('randstad_domo_rate_cards');
  if (localData) {
    try {
      return JSON.parse(localData);
    } catch {
      // ignore
    }
  }

  return INITIAL_MOCK_RATE_CARDS;
};

/**
 * Save new rate card records to Domo dataset collection or local fallback storage
 */
export const saveRateCardsToDomo = async (
  newRecords: RateCardRecord[],
  datasetAlias: string = DEFAULT_DATASET_ALIAS
): Promise<{ success: boolean; message: string }> => {
  if (isDomoEnvironment()) {
    try {
      console.log(`[Domo API] Posting ${newRecords.length} records to dataset alias: ${datasetAlias}`);
      // In Domo App framework, custom collection persistence can use domo.post or custom endpoints
      await window.domo.post(`/data/v2/${datasetAlias}`, newRecords);
      return { success: true, message: `Successfully published ${newRecords.length} records to Domo collection "${datasetAlias}".` };
    } catch (error: any) {
      console.warn('[Domo API] Save to Domo returned error:', error);
      // Still persist locally so app remains interactive
    }
  }

  // Fallback local storage update
  const existing = await fetchHistoricalRateCards(datasetAlias);
  const updatedCollection = [...newRecords, ...existing];
  localStorage.setItem('randstad_domo_rate_cards', JSON.stringify(updatedCollection));

  return {
    success: true,
    message: `Updated local collection with ${newRecords.length} newly normalized rate card records. (Local Fallback Mode)`,
  };
};
