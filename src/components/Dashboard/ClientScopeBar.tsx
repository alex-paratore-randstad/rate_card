import React from 'react';
import { Building2, Globe2, Users } from 'lucide-react';
import { useRateCard } from '../../context/RateCardContext';

const UNSPECIFIED = 'Unspecified';
const labelFor = (value: string) => value || UNSPECIFIED;

/**
 * Dashboard-wide scope. Rates from different clients or different countries are
 * not comparable, so aggregating them produces a variance that describes no
 * actual market. Both selectors drive the variance table together.
 */
export const ClientScopeBar: React.FC = () => {
  const {
    filters,
    setFilters,
    availableClients,
    availableCountries,
    scopedRateCards,
    currentRateCards,
  } = useRateCard();

  const mixedClients = filters.client === 'ALL' && availableClients.length > 1;
  const mixedCountries = filters.country === 'ALL' && availableCountries.length > 1;
  const mixed = mixedClients || mixedCountries;

  return (
    <div
      className="tonal-card"
      style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <Building2 size={20} color="var(--randstad-blue-primary)" />
        <label className="form-label" style={{ margin: 0 }}>Client:</label>
        <select
          className="form-control"
          style={{ width: '220px' }}
          value={filters.client}
          onChange={(e) => setFilters((prev) => ({ ...prev, client: e.target.value }))}
        >
          <option value="ALL">All Clients (Aggregated)</option>
          {availableClients.map((c) => (
            <option key={c || 'unspecified'} value={c}>{labelFor(c)}</option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <Globe2 size={20} color="var(--randstad-blue-primary)" />
        <label className="form-label" style={{ margin: 0 }}>Country:</label>
        <select
          className="form-control"
          style={{ width: '200px' }}
          value={filters.country}
          onChange={(e) => setFilters((prev) => ({ ...prev, country: e.target.value }))}
        >
          <option value="ALL">All Countries</option>
          {availableCountries.map((c) => (
            <option key={c || 'unspecified'} value={c}>{labelFor(c)}</option>
          ))}
        </select>
      </div>

      <span className="status-pill info">
        <Users size={14} />
        <span>{scopedRateCards.length} of {currentRateCards.length} records in scope</span>
      </span>

      {mixed && (
        <span className="status-pill warning" style={{ marginLeft: 'auto' }}>
          Blending {mixedClients ? `${availableClients.length} clients` : ''}
          {mixedClients && mixedCountries ? ' and ' : ''}
          {mixedCountries ? `${availableCountries.length} countries` : ''} — variance below describes
          no single market
        </span>
      )}
    </div>
  );
};
