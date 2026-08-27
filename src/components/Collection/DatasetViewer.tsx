import React, { useState } from 'react';
import { Database, Download, History, FileSpreadsheet } from 'lucide-react';
import { useRateCard } from '../../context/RateCardContext';
import { formatDateRandstad } from '../../utils/formatters';

const money = (amount: number): string => `$${amount.toFixed(2)}`;

/**
 * The label names the destination, not just the outcome. A local development
 * save satisfies the same record counts as a Domo write, so counting alone
 * would report "Saved to Domo" for data that never left the browser.
 */
const statusPill = (
  status: string,
  target: string
): { className: string; label: string } => {
  if (status === 'failed') return { className: 'error', label: 'Save failed' };
  if (target === 'local') {
    return { className: 'info', label: 'Local dev only' };
  }
  if (status === 'partial') return { className: 'warning', label: 'Partially saved' };
  return { className: 'success', label: 'Saved to Domo' };
};

export const DatasetViewer: React.FC = () => {
  const { rateCards, currentRateCards, batches } = useRateCard();
  const [activeSubTab, setActiveSubTab] = useState<'records' | 'batches'>('records');

  /** Records not in the newest upload of their year are kept as history. */
  const currentIds = new Set(currentRateCards.map((r) => r.id));

  const exportCSV = () => {
    if (rateCards.length === 0) return;
    const headers = [
      'ID', 'Batch ID', 'Job Title', 'Labor Type', 'Min Pay', 'Max Pay', 'Spread',
      'Rate Year', 'Client', 'Country', 'Source File', 'Source Tab', 'Uploaded At', 'Superseded',
    ];
    const quote = (value?: string) => `"${(value || '').replace(/"/g, '""')}"`;
    const rows = rateCards.map((r) => [
      r.id,
      r.batchId,
      quote(r.jobTitle),
      quote(r.laborType),
      r.minRate,
      r.maxRate,
      r.rateSpread,
      r.rateYear,
      quote(r.client),
      quote(r.country),
      quote(r.sourceFileName),
      quote(r.sourceSheet),
      r.uploadedAt,
      currentIds.has(r.id) ? 'No' : 'Yes',
    ]);

    const csvString = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Randstad_Rate_Card_Collection_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="tonal-card">
      <div className="card-header-row">
        <div>
          <h2>Domo Collection Dataset Management</h2>
          <span className="app-subtitle">
            Collection: <code>rate_card_history</code> ({rateCards.length} total records,{' '}
            {currentRateCards.length} current)
          </span>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn-secondary" onClick={exportCSV}>
            <Download size={16} />
            <span>Export Collection CSV</span>
          </button>
        </div>
      </div>

      <div className="navigation-tabs" style={{ marginBottom: '20px', maxWidth: '400px' }}>
        <button
          className={`nav-tab-button ${activeSubTab === 'records' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('records')}
        >
          <Database size={16} />
          <span>Records ({rateCards.length})</span>
        </button>
        <button
          className={`nav-tab-button ${activeSubTab === 'batches' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('batches')}
        >
          <History size={16} />
          <span>Upload History ({batches.length})</span>
        </button>
      </div>

      {activeSubTab === 'records' ? (
        <div className="table-container">
          <table className="randstad-table">
            <thead>
              <tr>
                <th>Job Title</th>
                <th>Labor Type</th>
                <th style={{ textAlign: 'right' }}>Min Pay</th>
                <th style={{ textAlign: 'right' }}>Max Pay</th>
                <th style={{ textAlign: 'right' }}>Spread</th>
                <th>Rate Year</th>
                <th>Client</th>
                <th>Country</th>
                <th>Tab</th>
                <th>Uploaded</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rateCards.length === 0 ? (
                <tr>
                  <td colSpan={11} style={{ textAlign: 'center', padding: '32px', color: '#415E7D' }}>
                    No records yet.
                  </td>
                </tr>
              ) : (
                rateCards.map((record) => {
                  const isCurrent = currentIds.has(record.id);
                  return (
                    <tr key={record.id} style={{ opacity: isCurrent ? 1 : 0.55 }}>
                      <td style={{ fontWeight: 600 }}>{record.jobTitle}</td>
                      <td>{record.laborType || '—'}</td>
                      <td style={{ textAlign: 'right', color: '#257F56', fontWeight: 600 }}>
                        {money(record.minRate)}
                      </td>
                      <td style={{ textAlign: 'right', color: '#255CA9', fontWeight: 600 }}>
                        {money(record.maxRate)}
                      </td>
                      <td style={{ textAlign: 'right' }}>{money(record.rateSpread)}</td>
                      <td style={{ fontWeight: 600 }}>{record.rateYear}</td>
                      <td>{record.client || '—'}</td>
                      <td>{record.country || '—'}</td>
                      <td style={{ fontSize: '0.8rem' }}>{record.sourceSheet || '—'}</td>
                      <td style={{ fontSize: '0.8rem' }}>
                        {formatDateRandstad(record.uploadedAt.slice(0, 10))}
                      </td>
                      <td>
                        {/* Superseded rows stay visible: this is the history that
                            answers "how did 2026 change between uploads". */}
                        <span className={`status-pill ${isCurrent ? 'success' : 'info'}`}>
                          {isCurrent ? 'Current' : 'Superseded'}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="table-container">
          <table className="randstad-table">
            <thead>
              <tr>
                <th>Source File</th>
                <th>Rate Years</th>
                <th>Client</th>
                <th>Country</th>
                <th style={{ textAlign: 'right' }}>Records</th>
                <th>Uploaded</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {batches.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '32px', color: '#415E7D' }}>
                    No uploads yet.
                  </td>
                </tr>
              ) : (
                batches.map((batch) => {
                  const pill = statusPill(batch.status, batch.target);
                  return (
                    <tr key={batch.batchId}>
                      <td style={{ fontWeight: 600 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <FileSpreadsheet size={16} color="#255CA9" />
                          <span>{batch.sourceFileName}</span>
                        </div>
                      </td>
                      <td>{batch.rateYears.join(', ')}</td>
                      <td>{batch.client || '—'}</td>
                      <td>{batch.country || '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>
                        {batch.savedCount} / {batch.recordCount}
                      </td>
                      <td style={{ fontSize: '0.85rem' }}>
                        {formatDateRandstad(batch.uploadedAt.slice(0, 10))}
                      </td>
                      <td>
                        {/* Reflects what actually reached Domo. */}
                        <span className={`status-pill ${pill.className}`} title={batch.statusMessage}>
                          {pill.label}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
