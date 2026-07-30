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
import { formatCurrencyRandstad } from '../../utils/formatters';

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
  const { rateCards } = useRateCard();

  // Extract list of unique job titles for selector
  const availableRoles = useMemo(() => {
    return Array.from(new Set(rateCards.map((r) => r.jobTitle))).sort();
  }, [rateCards]);

  const [selectedRole, setSelectedRole] = useState<string>(
    availableRoles[0] || 'Senior Full Stack Engineer'
  );

  // Group monthly trend data for selected role
  const chartData = useMemo(() => {
    const roleRecords = rateCards
      .filter((r) => r.jobTitle === selectedRole)
      .sort((a, b) => a.effectiveMonth.localeCompare(b.effectiveMonth));

    const months = Array.from(new Set(roleRecords.map((r) => r.effectiveMonth))).sort();

    const minRates = months.map((m) => {
      const rec = roleRecords.find((r) => r.effectiveMonth === m);
      return rec ? rec.minRate : null;
    });

    const maxRates = months.map((m) => {
      const rec = roleRecords.find((r) => r.effectiveMonth === m);
      return rec ? rec.maxRate : null;
    });

    const avgRates = months.map((m) => {
      const rec = roleRecords.find((r) => r.effectiveMonth === m);
      return rec ? rec.avgRate : null;
    });

    return {
      labels: months.map((m) => {
        const [yr, mo] = m.split('-');
        const dateObj = new Date(parseInt(yr), parseInt(mo) - 1, 1);
        return dateObj.toLocaleString('en-US', { month: 'short', year: 'numeric' });
      }),
      datasets: [
        {
          label: 'Maximum Pay Rate (USD)',
          data: maxRates,
          borderColor: '#255CA9', // Primary Blue
          backgroundColor: '#255CA9',
          borderWidth: 3,
          pointRadius: 5,
          tension: 0.1,
        },
        {
          label: 'Average Rate (USD)',
          data: avgRates,
          borderColor: '#007C82', // Tertiary Teal
          backgroundColor: '#007C82',
          borderWidth: 2.5,
          borderDash: [5, 5],
          pointRadius: 4,
          tension: 0.1,
        },
        {
          label: 'Minimum Pay Rate (USD)',
          data: minRates,
          borderColor: '#BAD808', // Lime Accent
          backgroundColor: '#BAD808',
          borderWidth: 3,
          pointRadius: 5,
          tension: 0.1,
        },
      ],
    };
  }, [rateCards, selectedRole]);

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
            Tracking monthly minimum and maximum rate evolution per role
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
            value={selectedRole}
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
