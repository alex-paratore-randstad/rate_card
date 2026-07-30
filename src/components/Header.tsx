import React from 'react';
import { Database, RefreshCw, UploadCloud } from 'lucide-react';
import { useRateCard } from '../context/RateCardContext';

export const Header: React.FC = () => {
  const { setActiveTab, refreshDataset, isLoading, rateCards } = useRateCard();

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
