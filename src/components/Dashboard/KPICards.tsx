import React from 'react';
import { Briefcase, TrendingUp, DollarSign, Layers, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { useRateCard } from '../../context/RateCardContext';
import { formatCurrencyRandstad, formatPercentageDrift } from '../../utils/formatters';

export const KPICards: React.FC = () => {
  const { metricSummary } = useRateCard();

  const isDriftPositive = metricSummary.monthlyDriftPercentage >= 0;

  return (
    <div className="kpi-grid">
      {/* KPI 1: Unique Job Roles */}
      <div className="kpi-card">
        <div>
          <div className="card-header-row">
            <span className="kpi-label">Unique Roles Tracked</span>
            <Briefcase size={20} color="#255CA9" />
          </div>
          <div className="display-metric">{metricSummary.totalRoles}</div>
        </div>
        <div className="kpi-footer-trend">
          <span className="status-pill info">Normalized Taxonomy</span>
        </div>
      </div>

      {/* KPI 2: Average Minimum Pay Rate */}
      <div className="kpi-card">
        <div>
          <div className="card-header-row">
            <span className="kpi-label">Avg Minimum Pay Rate</span>
            <DollarSign size={20} color="#007C82" />
          </div>
          <div className="display-metric" style={{ color: '#007C82' }}>
            {formatCurrencyRandstad(metricSummary.avgMinRate)}
          </div>
        </div>
        <div className="kpi-footer-trend">
          <span className="text-meta">Base Floor Rate</span>
        </div>
      </div>

      {/* KPI 3: Average Maximum Pay Rate */}
      <div className="kpi-card">
        <div>
          <div className="card-header-row">
            <span className="kpi-label">Avg Maximum Pay Rate</span>
            <DollarSign size={20} color="#255CA9" />
          </div>
          <div className="display-metric">
            {formatCurrencyRandstad(metricSummary.avgMaxRate)}
          </div>
        </div>
        <div className="kpi-footer-trend">
          <span className="text-meta">Ceiling Ceiling Rate</span>
        </div>
      </div>

      {/* KPI 4: Rate Spread (Max - Min) */}
      <div className="kpi-card">
        <div>
          <div className="card-header-row">
            <span className="kpi-label">Avg Rate Spread</span>
            <Layers size={20} color="#415E7D" />
          </div>
          <div className="display-metric" style={{ color: '#415E7D' }}>
            {formatCurrencyRandstad(metricSummary.avgSpread)}
          </div>
        </div>
        <div className="kpi-footer-trend">
          <span className="text-meta">Max - Min Variance</span>
        </div>
      </div>

      {/* KPI 5: Period Drift */}
      <div className="kpi-card">
        <div>
          <div className="card-header-row">
            <span className="kpi-label">Monthly Rate Drift</span>
            <TrendingUp size={20} color={isDriftPositive ? '#257F56' : '#E00F0F'} />
          </div>
          <div
            className="display-metric"
            style={{ color: isDriftPositive ? '#257F56' : '#E00F0F' }}
          >
            {formatPercentageDrift(metricSummary.monthlyDriftPercentage)}
          </div>
        </div>
        <div className="kpi-footer-trend">
          <span className={`status-pill ${isDriftPositive ? 'success' : 'error'}`}>
            {isDriftPositive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
            <span>Period over Period</span>
          </span>
        </div>
      </div>
    </div>
  );
};
