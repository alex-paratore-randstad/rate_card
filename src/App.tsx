import React from 'react';
import { RateCardProvider, useRateCard } from './context/RateCardContext';
import { Header } from './components/Header';
import { Navigation } from './components/Navigation';
import { KPICards } from './components/Dashboard/KPICards';
import { RateTrendChart } from './components/Dashboard/RateTrendChart';
import { RateSpreadTable } from './components/Dashboard/RateSpreadTable';
import { PeriodComparison } from './components/Dashboard/PeriodComparison';
import { FileUploader } from './components/Ingestion/FileUploader';
import { ColumnMappingModal } from './components/Ingestion/ColumnMappingModal';
import { DatasetViewer } from './components/Collection/DatasetViewer';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';

const MainLayout: React.FC = () => {
  const { activeTab, notificationMessage, clearNotification } = useRateCard();

  return (
    <div className="app-shell">
      <Header />

      <main className="main-content">
        {notificationMessage && (
          <div
            className={`status-pill ${
              notificationMessage.type === 'success'
                ? 'success'
                : notificationMessage.type === 'error'
                ? 'error'
                : 'info'
            }`}
            style={{
              width: '100%',
              padding: '12px 20px',
              borderRadius: '8px',
              marginBottom: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.9rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {notificationMessage.type === 'success' ? (
                <CheckCircle2 size={18} />
              ) : (
                <AlertCircle size={18} />
              )}
              <span>{notificationMessage.text}</span>
            </div>
            <button
              onClick={clearNotification}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
            >
              <X size={16} />
            </button>
          </div>
        )}

        <Navigation />

        {activeTab === 'dashboard' && (
          <>
            <KPICards />
            <RateTrendChart />
            <RateSpreadTable />
            <PeriodComparison />
          </>
        )}

        {activeTab === 'ingest' && <FileUploader />}

        {activeTab === 'collection' && <DatasetViewer />}
      </main>

      <ColumnMappingModal />
    </div>
  );
};

export default function App() {
  return (
    <RateCardProvider>
      <MainLayout />
    </RateCardProvider>
  );
}
