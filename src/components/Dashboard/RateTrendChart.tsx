import React, { useState, useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { TrendingUp, Filter } from 'lucide-react';
import { useRateCard } from '../../context/RateCardContext';
import { formatCurrencyRandstad, formatDateRandstad } from '../../utils/formatters';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

export const RateTrendChart: React.FC = () => {
  const { clientScopedRateCards: rateCards } = useRateCard();

  // Extract list of unique job titles for selector
  const availableRoles = useMemo(() => {
    return Array.from(new Set(rateCards.map((r) => r.jobTitle))).sort();
  }, [rateCards]);

  const [selectedRole, setSelectedRole] = useState<string>('');

  // Rate cards load asynchronously, so the selector's first render sees an empty
  // list. Derive the shown role instead of latching state onto that empty state.
  const effectiveRole =
    selectedRole && availableRoles.includes(selectedRole) ? selectedRole : availableRoles[0] ?? '';

  // Group trend data for the selected role by exact effective date
  const chartData = useMemo(() => {
    const roleRecords = rateCards.filter((r) => r.jobTitle === effectiveRole);
    const dates = Array.from(new Set(roleRecords.map((r) => r.effectiveDate))).sort();

    const rateOn = (date: string, pick: (r: (typeof roleRecords)[number]) => number) => {
      const rec = roleRecords.find((r) => r.effectiveDate === date);
      return rec ? pick(rec) : null;
    };

    return {
      labels: dates.map((d) => formatDateRandstad(d)),
      datasets: [
        {
          label: 'Maximum Pay Rate (USD)',
          data: dates.map((d) => rateOn(d, (r) => r.maxRate)),
          borderColor: '#1A509C', // Line sequence 1
          backgroundColor: '#1A509C',
          borderWidth: 3,
          pointRadius: 5,
          tension: 0.1,
        },
        {
          label: 'Average Rate (USD)',
          data: dates.map((d) => rateOn(d, (r) => r.avgRate)),
          borderColor: '#258AED', // Line sequence 3
          backgroundColor: '#258AED',
          borderWidth: 2.5,
          borderDash: [5, 5],
          pointRadius: 4,
          tension: 0.1,
        },
        {
          label: 'Minimum Pay Rate (USD)',
          data: dates.map((d) => rateOn(d, (r) => r.minRate)),
          borderColor: '#BBD900', // Line sequence 2
          backgroundColor: '#BBD900',
          borderWidth: 3,
          pointRadius: 5,
          tension: 0.1,
        },
      ],
    };
  }, [rateCards, effectiveRole]);

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top' as const,
        labels: {
          font: {
            family: 'Inter',
            size: 12,
            weight: 600,
          },
          color: '#001D35',
          usePointStyle: true,
          padding: 20,
        },
      },
      tooltip: {
        backgroundColor: '#001D35',
        titleFont: { family: 'Inter', size: 13, weight: 'bold' },
        bodyFont: { family: 'Source Sans 3', size: 13 },
        padding: 12,
        cornerRadius: 6,
        callbacks: {
          label: function (context: any) {
            return ` ${context.dataset.label}: ${formatCurrencyRandstad(context.raw)}`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          font: { family: 'Inter', size: 12 },
          color: '#415E7D',
        },
      },
      y: {
        grid: { color: 'rgba(194, 198, 211, 0.2)' },
        ticks: {
          font: { family: 'Inter', size: 12 },
          color: '#415E7D',
          callback: function (val: any) {
            return `USD $${val}`;
          },
        },
      },
    },
  };

  return (
    <div className="tonal-card">
      <div className="card-header-row">
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <TrendingUp size={20} color="#255CA9" />
            <span>Historical Rate Drift & Trend Analysis</span>
          </h2>
          <span className="app-subtitle">
            Tracking minimum and maximum rate evolution per role by effective date
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Filter size={16} color="#415E7D" />
          <label className="form-label" style={{ margin: 0 }}>
            Role:
          </label>
          <select
            className="form-control"
            style={{ width: '260px' }}
            value={effectiveRole}
            onChange={(e) => setSelectedRole(e.target.value)}
          >
            {availableRoles.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ height: '340px', width: '100%', marginTop: '16px' }}>
        <Line data={chartData} options={options as any} />
      </div>
    </div>
  );
};
