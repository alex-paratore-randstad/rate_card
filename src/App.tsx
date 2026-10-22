import React from 'react';
import { RateCardProvider, useRateCard } from './context/RateCardContext';
import { Header } from './components/Header';
import { Navigation } from './components/Navigation';
import { ClientScopeBar } from './components/Dashboard/ClientScopeBar';
import { RateCardTable } from './components/Dashboard/RateCardTable';
import { FileUploader } from './components/Ingestion/FileUploader';
import { ColumnMappingModal } from './components/Ingestion/ColumnMappingModal';
import { DatasetViewer } from './components/Collection/DatasetViewer';
import { ClientMatchPanel } from './components/Clients/ClientMatchPanel';
import { CoverageReport } from './components/Dashboard/CoverageReport';
import { TitleMatchPanel } from './components/Clients/TitleMatchPanel';
import { ComplianceReport } from './components/Dashboard/ComplianceReport';
import { TemplateComplianceReport } from './components/Dashboard/TemplateComplianceReport';
import { RegionalReport } from './components/Dashboard/RegionalReport';
import { CardQualityReport } from './components/Reports/CardQualityReport';
import { RateMovementReport } from './components/Reports/RateMovementReport';
import { RateConcentrationReport } from './components/Reports/RateConcentrationReport';
import { TitleMappingPanel } from './components/Mapping/TitleMappingPanel';
import { MethodReference } from './components/Method/MethodReference';
import { FeedbackPrompt } from './components/Feedback/FeedbackPrompt';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';
import { TabId } from './types/navigation';

/**
 * Screens where people review the data, and so where the feedback strip goes.
 * Ingest and the matching screens are data entry, which is not what feedback is
 * being gathered on; the header button still reaches them.
 */
const REVIEW_SCREENS: Partial<Record<TabId, string>> = {
  dashboard: 'Was this rate card view useful for your review?',
  cardquality: 'Were these card quality checks useful?',
  movement: 'Was this rate movement report useful?',
  concentration: 'Was this concentration report useful?',
  coverage: 'Was this coverage report useful?',
  compliance: 'Were these compliance findings useful?',
  regional: 'Was this regional view useful?',
  method: 'Did this explain the figures clearly enough?',
};

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

        {/* Command Center — the uploaded rate card, read two ways. */}
        {activeTab === 'dashboard' && (
          <>
            <ClientScopeBar />
            <RateCardTable />
          </>
        )}

        {activeTab === 'collection' && <DatasetViewer />}

        {activeTab === 'ingest' && <FileUploader />}

        {/* Reports — built on the uploaded cards alone, so no Domo prompt. */}
        {activeTab === 'cardquality' && (
          <>
            <ClientScopeBar />
            <CardQualityReport />
          </>
        )}

        {activeTab === 'movement' && (
          <>
            <ClientScopeBar />
            <RateMovementReport />
          </>
        )}

        {/* Card change against Domo spend — the one report here needing actuals. */}
        {activeTab === 'concentration' && (
          <>
            <ClientScopeBar />
            <RateConcentrationReport />
          </>
        )}

        {/* Matching — the uploaded mapping file. The scope bar drives the
            coverage figure, which is about the cards in scope. */}
        {activeTab === 'mappings' && (
          <>
            <ClientScopeBar />
            <TitleMappingPanel />
          </>
        )}

        {activeTab === 'clients' && <ClientMatchPanel />}

        {/* Title matching scores against actuals in the same scope, so it takes
            the scope bar too. */}
        {activeTab === 'titles' && (
          <>
            <ClientScopeBar />
            <TitleMatchPanel />
          </>
        )}

        {/* Coverage reads the same client/country scope as the dashboard, so the
            scope bar comes along rather than being duplicated. */}
        {activeTab === 'coverage' && (
          <>
            <ClientScopeBar />
            <CoverageReport />
          </>
        )}

        {/* Both checks are compliance findings, so they share a tab: the card
            band first, then the ceiling the VMS enforces independently. */}
        {activeTab === 'compliance' && (
          <>
            <ClientScopeBar />
            <ComplianceReport />
            <TemplateComplianceReport />
          </>
        )}

        {activeTab === 'regional' && (
          <>
            <ClientScopeBar />
            <RegionalReport />
          </>
        )}


        {/* No scope bar: the method does not vary by client or country. */}
        {activeTab === 'method' && <MethodReference />}

        {/* Keyed on the screen so an open form does not follow the reviewer
            to the next tab. */}
        {REVIEW_SCREENS[activeTab] && (
          <FeedbackPrompt key={activeTab} question={REVIEW_SCREENS[activeTab]} />
        )}
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
