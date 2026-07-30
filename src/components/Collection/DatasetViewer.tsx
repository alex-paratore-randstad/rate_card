import React, { useState } from 'react';
import { Database, Download, History, FileSpreadsheet } from 'lucide-react';
import { useRateCard } from '../../context/RateCardContext';
import { formatCurrencyRandstad, formatDateRandstad } from '../../utils/formatters';

export const DatasetViewer: React.FC = () => {
  const { rateCards, batches } = useRateCard();
  const [activeSubTab, setActiveSubTab] = useState<'records' | 'batches'>('records');

  const exportCSV = () => {
    if (rateCards.length === 0) return;
    const headers = ['ID', 'Job Title', 'Min Rate', 'Max Rate', 'Rate Spread', 'Effective Month', 'Category', 'Region', 'Source File'];
    const rows = rateCards.map(r => [
      r.id,
      `"${r.jobTitle.replace(/"/g, '""')}"`,
      r.minRate,
      r.maxRate,
      r.rateSpread,
      r.effectiveMonth,
      `"${(r.category || '').replace(/"/g, '""')}"`,
      `"${(r.region || '').replace(/"/g, '""')}"`,
      `"${(r.sourceFileName || '').replace(/"/g, '""')}"`
    ]);

    const csvString = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Randstad_Domo_Rate_Card_Collection_${new Date().toISOString().slice(0, 10)}.csv`);
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
            Dataset Alias: <code>rate_card_history</code> ({rateCards.length} Total Historical Entries)
          </span>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn-secondary" onClick={exportCSV}>
            <Download size={16} />
            <span>Export Collection CSV</span>
          </button>
        </div>
      </div>

      {/* Sub tabs: All Normalized Records vs Ingestion Batch History */}
      <div className="navigation-tabs" style={{ marginBottom: '20px', maxWidth: '400px' }}>
        <button
          className={`nav-tab-button ${activeSubTab === 'records' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('records')}
        >
          <Database size={16} />
          <span>Historical Records ({rateCards.length})</span>
        </button>

        <button
          className={`nav-tab-button ${activeSubTab === 'batches' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('batches')}
        >
          <History size={16} />
          <span>Batch Audit Log ({batches.length})</span>
        </button>
      </div>

      {activeSubTab === 'records' ? (
        <div className="table-container">
          <table className="randstad-table">
            <thead>
              <tr>
                <th>Record ID</th>
                <th>Job Title / Role</th>
                <th>Min Rate</th>
                <th>Max Rate</th>
                <th>Effective Month</th>
                <th>Category</th>
                <th>Source File</th>
                <th>Ingested Date</th>
              </tr>
            </thead>
            <tbody>
              {rateCards.map((record) => (
                <tr key={record.id}>
                  <td style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: '#677E95' }}>
                    {record.id.slice(0, 16)}...
                  </td>
                  <td style={{ fontWeight: 600 }}>{record.jobTitle}</td>
                  <td style={{ color: '#257F56', fontWeight: 600 }}>
                    {formatCurrencyRandstad(record.minRate, record.currency)}
                  </td>
                  <td style={{ color: '#255CA9', fontWeight: 600 }}>
                    {formatCurrencyRandstad(record.maxRate, record.currency)}
                  </td>
                  <td>{record.effectiveMonth}</td>
                  <td>
                    <span className="status-pill info">{record.category || 'General'}</span>
                  </td>
                  <td style={{ fontSize: '0.8rem', color: '#415E7D' }}>
                    {record.sourceFileName || 'Domo Sync'}
                  </td>
                  <td style={{ fontSize: '0.8rem' }}>{formatDateRandstad(record.ingestionDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="table-container">
          <table className="randstad-table">
            <thead>
              <tr>
                <th>Batch ID</th>
                <th>Source Report File</th>
                <th>Effective Month</th>
                <th>Records Ingested</th>
                <th>Ingestion Timestamp</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((batch) => (
                <tr key={batch.batchId}>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{batch.batchId}</td>
                  <td style={{ fontWeight: 600 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <FileSpreadsheet size={16} color="#255CA9" />
                      <span>{batch.sourceFileName}</span>
                    </div>
                  </td>
                  <td>{batch.effectiveMonth}</td>
                  <td style={{ fontWeight: 600 }}>{batch.recordCount} rows</td>
                  <td style={{ fontSize: '0.85rem' }}>{batch.ingestionTimestamp}</td>
                  <td>
                    <span className="status-pill success">Published to Domo</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
