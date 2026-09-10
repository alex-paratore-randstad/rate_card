import React from 'react';
import { RateCardProvider, useRateCard } from './context/RateCardContext';
import { Header } from './components/Header';
import { Navigation } from './components/Navigation';
import { ClientScopeBar } from './components/Dashboard/ClientScopeBar';
import { PayVarianceTable } from './components/Dashboard/PayVarianceTable';
import { FileUploader } from './components/Ingestion/FileUploader';
import { ColumnMappingModal } from './components/Ingestion/ColumnMappingModal';
import { DatasetViewer } from './components/Collection/DatasetViewer';
import { ClientMatchPanel } from './components/Clients/ClientMatchPanel';
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

        {/* Reporting is scoped to the pay variance view for now. The other
            dashboard cards are unmounted rather than deleted — their components
            are still in src/components/Dashboard if they are wanted back. */}
        {activeTab === 'dashboard' && (
          <>
            <ClientScopeBar />
            <PayVarianceTable />
          </>
        )}

        {activeTab === 'ingest' && <FileUploader />}

        {activeTab === 'clients' && <ClientMatchPanel />}

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
