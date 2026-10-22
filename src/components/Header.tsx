import React, { useState } from 'react';
import { Database, RefreshCw, UploadCloud, Cloud, CloudOff, MessageSquarePlus } from 'lucide-react';
import { useRateCard } from '../context/RateCardContext';
import { FeedbackDialog } from './Feedback/FeedbackPrompt';


export const Header: React.FC = () => {
  const { setActiveTab, refreshDataset, isLoading, rateCards, domoAccess } = useRateCard();
  const [feedbackOpen, setFeedbackOpen] = useState(false);

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
        {domoAccess === null ? (
          <div className="status-pill info">
            <Cloud size={14} />
            <span>Checking Domo…</span>
          </div>
        ) : domoAccess === 'none' ? (
          <div
            className="status-pill warning"
            title="Neither window.domo nor the /domo proxy responded — saves stay in this browser"
          >
            <CloudOff size={14} />
            <span>Local dev — not saving to Domo</span>
          </div>
        ) : (
          <div
            className="status-pill success"
            title={
              domoAccess === 'sdk'
                ? 'domo.js SDK detected — saves write to the Domo collection'
                : 'Reaching the collection through the app proxy — saves write to Domo'
            }
          >
            <Cloud size={14} />
            <span>Connected to Domo{domoAccess === 'proxy' ? ' (proxy)' : ''}</span>
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

        <button
          className="btn-secondary"
          onClick={() => setFeedbackOpen(true)}
          title="Tell us about anything on this screen"
        >
          <MessageSquarePlus size={16} />
          <span>Feedback</span>
        </button>

        <button className="btn-primary" onClick={() => setActiveTab('ingest')}>
          <UploadCloud size={16} />
          <span>Ingest Rate Card</span>
        </button>
      </div>

      {feedbackOpen && <FeedbackDialog onClose={() => setFeedbackOpen(false)} />}
    </header>
  );
};
