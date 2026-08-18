import React, { useMemo, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { Chart } from 'react-chartjs-2';
import { Layers3 } from 'lucide-react';
import { useRateCard } from '../../context/RateCardContext';
import {
  formatCurrencyRandstad,
  formatDateRandstad,
  formatPercentageDrift,
  orderRegions,
} from '../../utils/formatters';

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Tooltip, Legend);

/**
 * Average maximum bill rate per region, with each region's premium over the
 * baseline region. This is a within-period comparison across pricing tiers —
 * distinct from the heatmap, which compares one region against itself over time.
 */
export const RegionalUpliftSummary: React.FC = () => {
  const { clientScopedRateCards } = useRateCard();
  const [period, setPeriod] = useState<string>('');

  const periods = useMemo(
    () => Array.from(new Set(clientScopedRateCards.map((r) => r.effectiveDate))).sort().reverse(),
    [clientScopedRateCards]
  );

  // Derived rather than latched, so the async first render does not pin an empty value.
  const effectivePeriod = period && periods.includes(period) ? period : periods[0] ?? '';

  const { rows, baselineRegion, excludedRoles } = useMemo(() => {
    const scoped = clientScopedRateCards.filter((r) => r.effectiveDate === effectivePeriod);
    const allRegions = orderRegions(scoped);

    /**
     * Like-for-like basis: only roles priced in every region count toward the
     * averages. Comparing tiers whose averages are built from different sets of
     * roles is not a comparison at all — a role missing from one tier shifts
     * that tier's mean by its own rate rather than by any real premium.
     */
    const regionsByRole = new Map<string, Set<string>>();
    for (const r of scoped) {
      const set = regionsByRole.get(r.jobTitle) ?? new Set<string>();
      set.add(r.region || 'Unspecified');
      regionsByRole.set(r.jobTitle, set);
    }
    const completeRoles = new Set(
      Array.from(regionsByRole.entries())
        .filter(([, regions]) => regions.size === allRegions.length)
        .map(([title]) => title)
    );
    const excludedRoles = regionsByRole.size - completeRoles.size;
    const comparable = scoped.filter((r) => completeRoles.has(r.jobTitle));

    const totals = new Map<string, { sum: number; count: number }>();
    for (const r of comparable) {
      const key = r.region || 'Unspecified';
      const entry = totals.get(key) ?? { sum: 0, count: 0 };
      entry.sum += r.maxRate;
      entry.count += 1;
      totals.set(key, entry);
    }

    // Ladder order comes from the file's band order, not from the averages.
    const averages = allRegions
      .filter((region) => totals.has(region))
      .map((region) => {
        const t = totals.get(region)!;
        return { region, average: t.sum / t.count };
      });

    if (averages.length === 0) return { rows: [], baselineRegion: '', excludedRoles };

    // The literal Base Region band from the file drives the 0% reference,
    // falling back to the first band in file order when nothing is named "base".
    const named = averages.find((a) => /\bbase\b/i.test(a.region));
    const baseline = named ?? averages[0];

    return {
      baselineRegion: baseline.region,
      excludedRoles,
      rows: averages.map((a) => ({
        region: a.region,
        average: a.average,
        increase: baseline.average > 0 ? ((a.average - baseline.average) / baseline.average) * 100 : 0,
      })),
    };
  }, [clientScopedRateCards, effectivePeriod]);

  const chartData = useMemo(
    () => ({
      labels: rows.map((r) => r.region),
      datasets: [
        {
          type: 'bar' as const,
          label: 'Average Max Rate',
          data: rows.map((r) => r.average),
          backgroundColor: '#255CA9',
          yAxisID: 'y',
          order: 2,
        },
        {
          type: 'line' as const,
          label: '% Increase',
          data: rows.map((r) => r.increase),
          borderColor: '#1A509C',
          backgroundColor: '#1A509C',
          borderWidth: 2.5,
          pointRadius: 4,
          yAxisID: 'yPercent',
          order: 1,
        },
      ],
    }),
    [rows]
  );

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: {
          font: { family: 'Inter', size: 12, weight: 600 },
          color: '#001D35',
          usePointStyle: true,
          padding: 16,
        },
      },
      tooltip: {
        backgroundColor: '#001D35',
        padding: 12,
        cornerRadius: 6,
        callbacks: {
          label: (ctx: any) =>
            ctx.dataset.yAxisID === 'yPercent'
              ? ` ${ctx.dataset.label}: ${formatPercentageDrift(ctx.raw)}`
              : ` ${ctx.dataset.label}: ${formatCurrencyRandstad(ctx.raw)}`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { font: { family: 'Inter', size: 12 }, color: '#415E7D' },
        title: { display: true, text: 'Region', font: { family: 'Inter', size: 12, weight: 600 }, color: '#415E7D' },
      },
      y: {
        position: 'left' as const,
        grid: { color: 'rgba(194, 198, 211, 0.2)' },
        ticks: {
          font: { family: 'Inter', size: 12 },
          color: '#415E7D',
          callback: (val: any) => `USD $${val}`,
        },
        title: { display: true, text: 'Average Max Rate', font: { family: 'Inter', size: 12, weight: 600 }, color: '#415E7D' },
      },
      // A second axis is required, not cosmetic: a 0–10% series plotted against
      // a 0–100 currency axis flattens against the baseline and reads as noise.
      yPercent: {
        position: 'right' as const,
        grid: { display: false },
        ticks: {
          font: { family: 'Inter', size: 12 },
          color: '#415E7D',
          callback: (val: any) => `${Number(val).toFixed(0)}%`,
        },
        title: { display: true, text: '% Increase', font: { family: 'Inter', size: 12, weight: 600 }, color: '#415E7D' },
      },
    },
  };

  if (rows.length < 2) {
    return (
      <div className="tonal-card">
        <div className="card-header-row">
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Layers3 size={20} color="#255CA9" />
              <span>Average Maximum Bill Rates by Region</span>
            </h2>
            <span className="app-subtitle">Regional rate premium over the baseline region</span>
          </div>
        </div>
        <div className="tonal-card-sub">
          <span className="text-meta">
            Ingest a report with at least two region bands to compare regional uplift.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="tonal-card">
      <div className="card-header-row">
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Layers3 size={20} color="#255CA9" />
            <span>Average Maximum Bill Rates by Region</span>
          </h2>
          <span className="app-subtitle">
            Percentage increase measured against <strong>{baselineRegion}</strong>, as of{' '}
            {formatDateRandstad(effectivePeriod)}
          </span>
          {excludedRoles > 0 && (
            <div style={{ marginTop: '6px' }}>
              <span className="status-pill warning">
                {excludedRoles} role{excludedRoles === 1 ? '' : 's'} excluded — not priced in every region
              </span>
            </div>
          )}
        </div>

        <div>
          <label className="form-label">Effective Date:</label>
          <select
            className="form-control"
            style={{ width: '180px' }}
            value={effectivePeriod}
            onChange={(e) => setPeriod(e.target.value)}
          >
            {periods.map((p) => (
              <option key={`up-${p}`} value={p}>{formatDateRandstad(p)}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div className="table-container" style={{ flex: '1 1 320px', minWidth: '300px' }}>
          <table className="randstad-table">
            <thead>
              <tr>
                <th>Region</th>
                <th style={{ textAlign: 'right' }}>Average Max Rate</th>
                <th style={{ textAlign: 'right' }}>% Increase</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.region}>
                  <td style={{ fontWeight: 600 }}>{r.region}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrencyRandstad(r.average)}</td>
                  <td
                    style={{
                      textAlign: 'right',
                      fontWeight: 600,
                      color: r.region === baselineRegion ? '#415E7D' : '#257F56',
                    }}
                  >
                    {r.increase.toFixed(2)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ flex: '2 1 420px', minWidth: '360px', height: '340px' }}>
          <Chart type="bar" data={chartData as any} options={options as any} />
        </div>
      </div>
    </div>
  );
};
