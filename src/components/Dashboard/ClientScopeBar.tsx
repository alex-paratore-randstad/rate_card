import React from 'react';
import { Building2, Users } from 'lucide-react';
import { useRateCard } from '../../context/RateCardContext';

/** Migrated pre-client records carry an empty client string. */
const UNSPECIFIED_LABEL = 'Unspecified Client';
const labelFor = (client: string) => client || UNSPECIFIED_LABEL;

/**
 * Dashboard-wide client scope. Rate cards from different clients are not
 * comparable, so aggregating them produces headline figures that describe no
 * actual client. This selector drives the KPI cards, the trend chart, the
 * period comparison, and the rate matrix together.
 */
export const ClientScopeBar: React.FC = () => {
  const { filters, setFilters, availableClients, clientScopedRateCards, rateCards } = useRateCard();

  const isAggregated = filters.client === 'ALL';
  const showsMixedWarning = isAggregated && availableClients.length > 1;

  return (
    <div
      className="tonal-card"
      style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <Building2 size={20} color="var(--randstad-blue-primary)" />
        <label className="form-label" style={{ margin: 0 }}>
          Client Scope:
        </label>
        <select
          className="form-control"
          style={{ width: '260px' }}
          value={filters.client}
          onChange={(e) =>
            // Category and date options are drawn from the scoped set, so a
            // selection made under the previous client would match nothing here.
            setFilters((prev) => ({
              ...prev,
              client: e.target.value,
              category: 'ALL',
              selectedDate: 'ALL',
            }))
          }
        >
          <option value="ALL">All Clients (Aggregated)</option>
          {availableClients.map((c) => (
            <option key={c || 'unspecified'} value={c}>
              {labelFor(c)}
            </option>
          ))}
        </select>
      </div>

      <span className="status-pill info">
        <Users size={14} />
        <span>
          {clientScopedRateCards.length} of {rateCards.length} records in scope
        </span>
      </span>

      {showsMixedWarning && (
        <span className="status-pill warning" style={{ marginLeft: 'auto' }}>
          Blending {availableClients.length} clients — metrics below describe no single client
        </span>
      )}

      {!isAggregated && (
        <span className="text-meta" style={{ marginLeft: 'auto' }}>
          All dashboard metrics scoped to {labelFor(filters.client)}
        </span>
      )}
    </div>
  );
};
