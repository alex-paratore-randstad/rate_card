import React from 'react';
import { Database, RefreshCw, UploadCloud, Cloud, CloudOff } from 'lucide-react';
import { useRateCard } from '../context/RateCardContext';
import { isDomoEnvironment } from '../services/domoService';

export const Header: React.FC = () => {
  const { setActiveTab, refreshDataset, isLoading, rateCards } = useRateCard();
  const inDomo = isDomoEnvironment();

  return (
    <header className="brand-header">
      <div className="brand-logo-group">
        <div className="brand-badge">randstad</div>
        <div className="app-title-group">
          <h1>Domo Rate Card Tracker</h1>
          <span className="app-subtitle">Historical Rate Analytics & Ingestion Engine</span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {/* Whether the Domo SDK is present decides where a save goes. Showing it
            means a local-only save is never a surprise discovered after upload. */}
        {inDomo ? (
          <div className="status-pill success" title="window.domo detected — saves write to the Domo collection">
            <Cloud size={14} />
            <span>Connected to Domo</span>
          </div>
        ) : (
          <div
            className="status-pill warning"
            title="window.domo not found — this is local development, saves stay in the browser"
          >
            <CloudOff size={14} />
            <span>Local dev — not saving to Domo</span>
          </div>
        )}

        <div className="status-pill info">
          <Database size={14} />
          <span>{rateCards.length} Collection Records</span>
        </div>

        <button
          className="btn-secondary"
          onClick={() => refreshDataset()}
          disabled={isLoading}
          title="Refresh dataset from Domo collection"
        >
          <RefreshCw size={16} className={isLoading ? 'spin' : ''} />
          <span>Sync Domo</span>
        </button>

        <button className="btn-primary" onClick={() => setActiveTab('ingest')}>
          <UploadCloud size={16} />
          <span>Ingest Rate Card</span>
        </button>
      </div>
    </header>
  );
};
