import React from 'react';
import { LayoutDashboard, FileUp, Database } from 'lucide-react';
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
        className={`nav-tab-button ${activeTab === 'collection' ? 'active' : ''}`}
        onClick={() => setActiveTab('collection')}
      >
        <Database size={18} />
        <span>Domo Collection Dataset</span>
      </button>
    </nav>
  );
};
