import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import {
  RateCardRecord,
  NormalizedIngestionBatch,
  IngestionPreviewData,
  RateCardFilterState,
  ClientAlias,
  ClientDirectory,
  ClientDirectoryEntry,
  ClientMatchMethod,
  ClientResolution,
  TitleAlias,
  TitleMatchMethod,
  TitleMapping,
  StandardTitleResolution,
  StandardTitleList,
} from '../types/rateCard';
import { TabId } from '../types/navigation';
import {
  fetchHistoricalRateCards,
  saveRateCardsToDomo,
  fetchBatches,
  saveBatchToDomo,
  probeDomoAccess,
  DomoAccess,
  fetchClientDirectory,
  saveClientDirectory,
  fetchClientAliases,
  saveClientAlias,
  deleteClientAlias,
  fetchTitleAliases,
  saveTitleAliases,
  deleteTitleAlias,
  fetchTitleMappings,
  saveTitleMappings,
  deleteTitleMapping,
  clearTitleMappings as clearStoredTitleMappings,
  fetchStandardTitles,
  saveStandardTitles,
} from '../services/domoService';
import { buildDecision, effectiveMappings, resolveTitles } from '../services/titleMappingService';
import { normalizeClientName, resolveClients } from '../services/clientMatchService';
import {
  fetchClientDirectoryFromDataset,
  fetchAssignmentActuals,
} from '../services/datasetService';
import { AssignmentActualRow } from '../types/domoDatasets';
import { countryKey } from '../services/countryService';
import { normalizeJobTitle } from '../services/titleService';
import { toDomoDateTime } from '../utils/formatters';

interface RateCardContextType {
  /** Every record ever ingested, including superseded uploads. */
  rateCards: RateCardRecord[];
  /** The latest upload of each rate year — what every report reads. */
  currentRateCards: RateCardRecord[];
  /** currentRateCards narrowed by the client and country scope. */
  scopedRateCards: RateCardRecord[];
  batches: NormalizedIngestionBatch[];
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
  previewData: IngestionPreviewData | null;
  setPreviewData: (data: IngestionPreviewData | null) => void;
  filters: RateCardFilterState;
  setFilters: React.Dispatch<React.SetStateAction<RateCardFilterState>>;
  availableClients: string[];
  availableCountries: string[];
  /** Candidate clients from Domo, or null until a directory has been loaded. */
  clientDirectory: ClientDirectory | null;
  /** Confirmed uploaded-name to client-code pairings. */
  clientAliases: ClientAlias[];
  /** Every distinct uploaded client with its decision or ranked candidates. */
  clientResolutions: ClientResolution[];
  /** Replace the candidate list. */
  loadClientDirectory: (entries: ClientDirectoryEntry[], source: ClientDirectory['source']) => Promise<void>;
  /** Replace it from the mapped Domo dataset rather than a paste. */
  loadClientDirectoryFromDomo: () => Promise<void>;
  /** Record a decision for one uploaded client. */
  resolveClient: (
    uploadedClient: string,
    choice: { clientCode: string; accountName: string } | null,
    method: ClientMatchMethod,
    score: number
  ) => Promise<void>;
  /** Send a client back to the review list. */
  unresolveClient: (uploadedClient: string) => Promise<void>;
  /** Confirmed card-title to actuals-title pairings. */
  titleAliases: TitleAlias[];
  /** Record one or many title decisions. Bulk is the normal case here. */
  resolveTitleMatches: (
    decisions: {
      clientCode: string;
      cardTitle: string;
      actualTitle: string;
      actualTitleKey: string;
      method: TitleMatchMethod;
      score: number;
    }[]
  ) => Promise<void>;
  /** Send a title back to the queue. */
  unresolveTitle: (clientCode: string, cardTitle: string) => Promise<void>;
  /** The uploaded standard title list, or null until one is loaded. */
  standardTitles: StandardTitleList | null;
  /** Replace the stored list. */
  loadStandardTitles: (list: StandardTitleList) => Promise<boolean>;
  clearStandardTitles: () => Promise<void>;
  /** Every distinct current card title, matched onto the standard list. */
  titleResolutions: StandardTitleResolution[];
  /**
   * What reports group by: reviewed decisions, then the matcher's proposal for
   * every title nobody has reviewed. Needs no Domo connection.
   */
  titleMappings: TitleMapping[];
  /** Record reviewed decisions. An empty standard title means none fits. */
  decideTitles: (
    decisions: { resolution: StandardTitleResolution; standardTitle: string }[]
  ) => Promise<boolean>;
  /** Drop a decision, so the title goes back to the matcher's proposal. */
  undoTitleDecision: (resolution: StandardTitleResolution) => Promise<void>;
  /** Discard every reviewed decision. */
  clearTitleMappings: () => Promise<void>;
  /** Assignment actuals, or null until loaded. Fetched on demand, not at boot. */
  assignmentActuals: AssignmentActualRow[] | null;
  /** Null while idle, true while the fetch is in flight. */
  actualsLoading: boolean;
  loadAssignmentActuals: () => Promise<void>;
  ingestNewBatch: (
    records: RateCardRecord[],
    sourceFileName: string,
    batchId: string,
    uploadedAt: string,
    rateYears: string[]
  ) => Promise<boolean>;
  refreshDataset: () => Promise<void>;
  isLoading: boolean;
  /** null while the connection probe is still running. */
  domoAccess: DomoAccess | null;
  notificationMessage: { type: 'success' | 'error' | 'info'; text: string } | null;
  clearNotification: () => void;
}

const RateCardContext = createContext<RateCardContextType | undefined>(undefined);

export const RateCardProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [rateCards, setRateCards] = useState<RateCardRecord[]>([]);
  const [batches, setBatches] = useState<NormalizedIngestionBatch[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [previewData, setPreviewData] = useState<IngestionPreviewData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [notificationMessage, setNotificationMessage] = useState<
    { type: 'success' | 'error' | 'info'; text: string } | null
  >(null);

  const [assignmentActuals, setAssignmentActuals] = useState<AssignmentActualRow[] | null>(null);
  const [actualsLoading, setActualsLoading] = useState<boolean>(false);
  const [clientDirectory, setClientDirectory] = useState<ClientDirectory | null>(null);
  const [clientAliases, setClientAliases] = useState<ClientAlias[]>([]);
  const [titleAliases, setTitleAliases] = useState<TitleAlias[]>([]);
  const [titleDecisions, setTitleDecisions] = useState<TitleMapping[]>([]);
  const [standardTitles, setStandardTitles] = useState<StandardTitleList | null>(null);

  const [filters, setFilters] = useState<RateCardFilterState>({ client: 'ALL', country: 'ALL' });
  const [domoAccess, setDomoAccess] = useState<DomoAccess | null>(null);

  const refreshDataset = async () => {
    setIsLoading(true);
    try {
      setDomoAccess(await probeDomoAccess());
      const [records, batchList] = await Promise.all([fetchHistoricalRateCards(), fetchBatches()]);
      setRateCards(records);
      setBatches(batchList);

      // Client matching is a supporting feature: if its collections are not
      // provisioned yet the reports must still load, so these failures are
      // logged rather than thrown.
      try {
        const [directory, aliases, titles, mappings] = await Promise.all([
          fetchClientDirectory(),
          fetchClientAliases(),
          fetchTitleAliases(),
          fetchTitleMappings(),
        ]);
        setClientDirectory(directory);
        setClientAliases(aliases);
        setTitleAliases(titles);
        setTitleDecisions(mappings);
      } catch (err) {
        console.warn('[Matching] Could not load the directory, aliases or mappings:', err);
      }
      // Separately, so a collection not yet provisioned costs only itself.
      try {
        setStandardTitles(await fetchStandardTitles());
      } catch (err) {
        console.warn('[Matching] Could not load the standard title list:', err);
      }
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

  /**
   * Canonical country keys present in the current records.
   *
   * Keyed rather than raw so two spellings of one country stop appearing as two
   * markets — an upload tagged "USA" and one tagged "US" describe the same
   * bands, and offering both as separate scopes invites splitting a report in
   * half for no reason.
   */
  const availableCountries = useMemo(
    () => Array.from(new Set(currentRateCards.map((r) => countryKey(r.country || '')))).sort(),
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
          (filters.country === 'ALL' || countryKey(r.country || '') === filters.country)
      ),
    [currentRateCards, filters]
  );

  const loadClientDirectory = async (
    entries: ClientDirectoryEntry[],
    source: ClientDirectory['source']
  ) => {
    const directory: ClientDirectory = { entries, loadedAt: toDomoDateTime(), source };
    try {
      await saveClientDirectory(directory);
      setClientDirectory(directory);
      setNotificationMessage({
        type: 'success',
        text: `Loaded ${entries.length} candidate clients.`,
      });
    } catch (err: any) {
      setNotificationMessage({
        type: 'error',
        text: `Could not save the client directory: ${err?.message || 'unknown error'}`,
      });
    }
  };

  /**
   * Load the candidate list from the mapped dataset.
   *
   * Preferred over pasting once the app is published: the paste path exists
   * because dataset mappings only take effect on publish, so there had to be a
   * way to work before one had happened.
   */
  const loadClientDirectoryFromDomo = async () => {
    try {
      const { entries, source, skipped, rowCount, columns } = await fetchClientDirectoryFromDataset();
      if (!entries.length) {
        // Say which of the two failures this is. "No usable rows" alone sent the
        // last round of debugging to the browser console for information the
        // message could have carried itself.
        setNotificationMessage({
          type: 'error',
          text: rowCount
            ? `The dataset returned ${rowCount} row(s), but none carried both a client code and an ` +
              `account name. Columns found: ${columns.join(', ') || '(none)'}. Expected ` +
              `rsr_client_code and account_name.`
            : 'The client directory dataset returned zero rows. Check the dataflow has run, and ' +
              'that the dataset is bound to this card and shared with the app.',
        });
        return;
      }
      await loadClientDirectory(entries, 'dataset');
      if (source === 'local-seed' || skipped) {
        setNotificationMessage({
          type: 'info',
          text:
            `Loaded ${entries.length} candidate clients` +
            (source === 'local-seed' ? ' from locally seeded rows, not from Domo' : '') +
            (skipped ? `; skipped ${skipped} row(s) missing a code or name` : '') +
            '.',
        });
      }
    } catch (err: any) {
      setNotificationMessage({
        type: 'error',
        text: `Could not read the client directory dataset: ${err?.message || 'unknown error'}`,
      });
    }
  };

  /**
   * Record how one uploaded client string maps onto Domo. A null `choice`
   * records that there is no counterpart, which is a real answer — it stops the
   * client being offered for review again.
   */
  const resolveClient = async (
    uploadedClient: string,
    choice: { clientCode: string; accountName: string } | null,
    method: ClientMatchMethod,
    score: number
  ) => {
    const normalizedKey = normalizeClientName(uploadedClient);
    const existing = clientAliases.find((a) => a.normalizedKey === normalizedKey);

    const alias: ClientAlias = {
      id: existing?.id || '',
      uploadedClient,
      normalizedKey,
      clientCode: choice?.clientCode || '',
      accountName: choice?.accountName || '',
      method,
      score,
      confirmedAt: toDomoDateTime(),
    };

    try {
      const saved = await saveClientAlias(alias);
      setClientAliases((prev) => [
        saved,
        ...prev.filter((a) => a.normalizedKey !== normalizedKey),
      ]);
    } catch (err: any) {
      setNotificationMessage({
        type: 'error',
        text: `Could not save the match for "${uploadedClient}": ${err?.message || 'unknown error'}`,
      });
    }
  };

  const unresolveClient = async (uploadedClient: string) => {
    const normalizedKey = normalizeClientName(uploadedClient);
    const existing = clientAliases.find((a) => a.normalizedKey === normalizedKey);
    if (!existing) return;

    try {
      await deleteClientAlias(existing);
      setClientAliases((prev) => prev.filter((a) => a.normalizedKey !== normalizedKey));
    } catch (err: any) {
      setNotificationMessage({
        type: 'error',
        text: `Could not clear the match for "${uploadedClient}": ${err?.message || 'unknown error'}`,
      });
    }
  };

  /**
   * Record title decisions.
   *
   * Takes a list rather than one at a time because accepting in bulk is the
   * normal path — a card carries hundreds of titles and most resolve exactly,
   * so a one-at-a-time API would make the common case the slow one. Partial
   * failure is reported rather than swallowed: the decisions that landed are
   * kept, and the count that did not is surfaced.
   */
  const resolveTitleMatches: RateCardContextType['resolveTitleMatches'] = async (decisions) => {
    if (!decisions.length) return;

    const now = toDomoDateTime();
    const prepared: TitleAlias[] = decisions.map((d) => {
      const cardTitleKey = normalizeJobTitle(d.cardTitle);
      const existing = titleAliases.find(
        (a) => a.clientCode === d.clientCode && a.cardTitleKey === cardTitleKey
      );
      return {
        id: existing?.id || '',
        clientCode: d.clientCode,
        cardTitle: d.cardTitle,
        cardTitleKey,
        actualTitle: d.method === 'none' ? '' : d.actualTitle,
        actualTitleKey: d.method === 'none' ? '' : d.actualTitleKey,
        method: d.method,
        score: d.score,
        confirmedAt: now,
      };
    });

    try {
      const { saved, failed, firstError } = await saveTitleAliases(prepared);
      if (saved.length) {
        const savedKeys = new Set(saved.map((a) => `${a.clientCode}||${a.cardTitleKey}`));
        setTitleAliases((prev) => [
          ...saved,
          ...prev.filter((a) => !savedKeys.has(`${a.clientCode}||${a.cardTitleKey}`)),
        ]);
      }
      if (failed) {
        setNotificationMessage({
          type: 'error',
          text:
            `Saved ${saved.length} of ${prepared.length} title matches; ${failed} failed.` +
            (firstError ? ` First error: ${firstError}` : ''),
        });
      } else if (prepared.length > 1) {
        setNotificationMessage({
          type: 'success',
          text: `Saved ${saved.length} title matches.`,
        });
      }
    } catch (err: any) {
      setNotificationMessage({
        type: 'error',
        text: `Could not save the title matches: ${err?.message || 'unknown error'}`,
      });
    }
  };

  const unresolveTitle = async (clientCode: string, cardTitle: string) => {
    const cardTitleKey = normalizeJobTitle(cardTitle);
    const existing = titleAliases.find(
      (a) => a.clientCode === clientCode && a.cardTitleKey === cardTitleKey
    );
    if (!existing) return;

    try {
      await deleteTitleAlias(existing);
      setTitleAliases((prev) =>
        prev.filter((a) => !(a.clientCode === clientCode && a.cardTitleKey === cardTitleKey))
      );
    } catch (err: any) {
      setNotificationMessage({
        type: 'error',
        text: `Could not clear the title match: ${err?.message || 'unknown error'}`,
      });
    }
  };

  /**
   * Replace the standard title list.
   *
   * Reviewed decisions are kept. One that names a title the new list no longer
   * carries still applies, and shows in the review list as a standard outside
   * the list, so it can be redone rather than silently lost.
   */
  const loadStandardTitles: RateCardContextType['loadStandardTitles'] = async (list) => {
    try {
      await saveStandardTitles(list);
      setStandardTitles(list);
      setNotificationMessage({
        type: 'success',
        text: `Loaded ${list.titles.length} standard titles. Every card title has been matched to them.`,
      });
      return true;
    } catch (err: any) {
      setNotificationMessage({
        type: 'error',
        text: `Could not store the standard title list: ${err?.message || 'unknown error'}`,
      });
      return false;
    }
  };

  const clearStandardTitles = async () => {
    try {
      await saveStandardTitles(null);
      setStandardTitles(null);
    } catch (err: any) {
      setNotificationMessage({
        type: 'error',
        text: `Could not remove the standard title list: ${err?.message || 'unknown error'}`,
      });
    }
  };

  const decideTitles: RateCardContextType['decideTitles'] = async (items) => {
    if (!items.length) return true;
    const decidedAt = toDomoDateTime();
    const decisions = items.map(({ resolution, standardTitle }) =>
      buildDecision(resolution, standardTitle, decidedAt)
    );
    try {
      const { saved, failed, firstError } = await saveTitleMappings(decisions);
      const keys = new Set(saved.map((d) => d.uploadedTitleKey));
      setTitleDecisions((prev) => [...saved, ...prev.filter((d) => !keys.has(d.uploadedTitleKey))]);
      if (failed) {
        setNotificationMessage({
          type: 'error',
          text:
            `Saved ${saved.length} of ${decisions.length} title decisions; ${failed} failed.` +
            (firstError ? ` First error: ${firstError}` : ''),
        });
        return false;
      }
      return true;
    } catch (err: any) {
      setNotificationMessage({
        type: 'error',
        text: `Could not save the title decision: ${err?.message || 'unknown error'}`,
      });
      return false;
    }
  };

  const undoTitleDecision = async (resolution: StandardTitleResolution) => {
    if (!resolution.decision) return;
    try {
      await deleteTitleMapping(resolution.decision);
      setTitleDecisions((prev) =>
        prev.filter((d) => d.uploadedTitleKey !== resolution.uploadedTitleKey)
      );
    } catch (err: any) {
      setNotificationMessage({
        type: 'error',
        text: `Could not undo the title decision: ${err?.message || 'unknown error'}`,
      });
    }
  };

  const clearTitleMappings = async () => {
    try {
      await clearStoredTitleMappings();
      setTitleDecisions([]);
    } catch (err: any) {
      setNotificationMessage({
        type: 'error',
        text: `Could not clear the title decisions: ${err?.message || 'unknown error'}`,
      });
    }
  };

  /**
   * Fetch the assignment actuals.
   *
   * Deliberately on demand rather than at boot: this is the one large read in
   * the app, and every other screen works without it. Loading it when the app
   * opens would make the dashboard wait on data only the coverage report uses.
   */
  const loadAssignmentActuals = async () => {
    setActualsLoading(true);
    try {
      const { rows, source, warnings } = await fetchAssignmentActuals();
      setAssignmentActuals(rows);
      if (source === 'local-seed') {
        setNotificationMessage({
          type: 'info',
          text: `Loaded ${rows.length} assignment row(s) from locally seeded data, not from Domo.`,
        });
      } else if (warnings.length) {
        setNotificationMessage({ type: 'info', text: warnings[0] });
      }
    } catch (err: any) {
      setNotificationMessage({
        type: 'error',
        text: `Could not read the assignment actuals: ${err?.message || 'unknown error'}`,
      });
    } finally {
      setActualsLoading(false);
    }
  };

  /**
   * Distinct uploaded client strings with how many records each carries, so the
   * review list leads with the clients that matter most. Blank clients are
   * excluded — there is nothing to match.
   */
  const uploadedClientCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const record of currentRateCards) {
      const client = (record.client || '').trim();
      if (!client) continue;
      counts.set(client, (counts.get(client) ?? 0) + 1);
    }
    return Array.from(counts, ([client, recordCount]) => ({ client, recordCount }));
  }, [currentRateCards]);

  const clientResolutions = useMemo(
    () => resolveClients(uploadedClientCounts, clientDirectory?.entries ?? [], clientAliases),
    [uploadedClientCounts, clientDirectory, clientAliases]
  );

  /**
   * Matched over the current cards rather than the scoped ones: the standard
   * list is global, so a title's match must not depend on which client happens
   * to be selected. The review screen narrows to the scope itself.
   */
  const titleResolutions = useMemo(
    () => resolveTitles(currentRateCards, standardTitles?.titles ?? [], titleDecisions),
    [currentRateCards, standardTitles, titleDecisions]
  );

  const titleMappings = useMemo(
    () => effectiveMappings(titleResolutions, titleDecisions),
    [titleResolutions, titleDecisions]
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
        clientDirectory,
        clientAliases,
        clientResolutions,
        loadClientDirectory,
        loadClientDirectoryFromDomo,
        resolveClient,
        unresolveClient,
        titleAliases,
        resolveTitleMatches,
        unresolveTitle,
        standardTitles,
        loadStandardTitles,
        clearStandardTitles,
        titleResolutions,
        titleMappings,
        decideTitles,
        undoTitleDecision,
        clearTitleMappings,
        assignmentActuals,
        actualsLoading,
        loadAssignmentActuals,
        ingestNewBatch,
        refreshDataset,
        isLoading,
        domoAccess,
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
