import React from 'react';
import { LayoutDashboard, FileUp, Database, Link2, ShieldCheck } from 'lucide-react';
import { useRateCard } from '../context/RateCardContext';

export const Navigation: React.FC = () => {
  const { activeTab, setActiveTab } = useRateCard();

  return (
    <nav className="navigation-tabs">
      <button
        className={`nav-tab-button ${activeTab === 'dashboard' ? 'active' : ''}`}
        onClick={() => setActiveTab('dashboard')}
      >
        <LayoutDashboard size={18} />
        <span>Rate Command Center</span>
      </button>

      <button
        className={`nav-tab-button ${activeTab === 'ingest' ? 'active' : ''}`}
        onClick={() => setActiveTab('ingest')}
      >
        <FileUp size={18} />
        <span>Ingest Monthly Report</span>
      </button>

      <button
        className={`nav-tab-button ${activeTab === 'clients' ? 'active' : ''}`}
        onClick={() => setActiveTab('clients')}
      >
        <Link2 size={18} />
        <span>Client Matching</span>
      </button>

      <button
        className={`nav-tab-button ${activeTab === 'coverage' ? 'active' : ''}`}
        onClick={() => setActiveTab('coverage')}
      >
        <ShieldCheck size={18} />
        <span>Card Coverage</span>
      </button>

      <button
        className={`nav-tab-button ${activeTab === 'collection' ? 'active' : ''}`}
        onClick={() => setActiveTab('collection')}
      >
        <Database size={18} />
        <span>Domo Collection Dataset</span>
      </button>
    </nav>
  );
};
