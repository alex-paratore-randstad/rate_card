import React from 'react';
import { Search } from 'lucide-react';
import { useRateCard } from '../../context/RateCardContext';
import { formatCurrencyRandstad } from '../../utils/formatters';

export const RateSpreadTable: React.FC = () => {
  const { filteredRateCards, filters, setFilters, rateCards } = useRateCard();

  const categories = Array.from(new Set(rateCards.map((r) => r.category || 'General Staffing'))).sort();
  const months = Array.from(new Set(rateCards.map((r) => r.effectiveMonth))).sort().reverse();

  return (
    <div className="tonal-card">
      <div className="card-header-row">
        <div>
          <h2>Rate Card Matrix & Role Details</h2>
          <span className="app-subtitle">
            Showing {filteredRateCards.length} normalized rate entries
          </span>
        </div>

        {/* Filter controls */}
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', width: '240px' }}>
            <Search
              size={16}
              color="#415E7D"
              style={{ position: 'absolute', left: '12px', top: '12px' }}
            />
            <input
              type="text"
              className="form-control"
              style={{ paddingLeft: '36px' }}
              placeholder="Search job title or category..."
              value={filters.searchTerm}
              onChange={(e) => setFilters((prev) => ({ ...prev, searchTerm: e.target.value }))}
            />
          </div>

          <select
            className="form-control"
            style={{ width: '160px' }}
            value={filters.category}
            onChange={(e) => setFilters((prev) => ({ ...prev, category: e.target.value }))}
          >
            <option value="ALL">All Categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            className="form-control"
            style={{ width: '160px' }}
            value={filters.selectedMonth}
            onChange={(e) => setFilters((prev) => ({ ...prev, selectedMonth: e.target.value }))}
          >
            <option value="ALL">All Months</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="table-container">
        <table className="randstad-table">
          <thead>
            <tr>
              <th>Job Title / Role</th>
              <th>Category</th>
              <th>Min Rate</th>
              <th>Max Rate</th>
              <th>Rate Spread</th>
              <th>Effective Month</th>
              <th>Source Report</th>
            </tr>
          </thead>
          <tbody>
            {filteredRateCards.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '32px', color: '#415E7D' }}>
                  No rate card records match your filter criteria.
                </td>
              </tr>
            ) : (
              filteredRateCards.map((record) => (
                <tr key={record.id}>
                  <td>
                    <div>{record.jobTitle}</div>
                    {record.skillLevel && (
                      <span className="text-meta" style={{ fontSize: '0.65rem' }}>
                        {record.skillLevel}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className="status-pill info">{record.category || 'General'}</span>
                  </td>
                  <td style={{ color: '#257F56', fontWeight: 600 }}>
                    {formatCurrencyRandstad(record.minRate, record.currency)}
                  </td>
                  <td style={{ color: '#255CA9', fontWeight: 600 }}>
                    {formatCurrencyRandstad(record.maxRate, record.currency)}
                  </td>
                  <td style={{ fontWeight: 600 }}>
                    {formatCurrencyRandstad(record.rateSpread, record.currency)}
                  </td>
                  <td>{record.effectiveMonth}</td>
                  <td style={{ fontSize: '0.8rem', color: '#677E95' }}>
                    {record.sourceFileName || 'System Upload'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
