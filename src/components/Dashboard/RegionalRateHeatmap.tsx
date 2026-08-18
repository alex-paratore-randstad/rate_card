import React, { useMemo, useState } from 'react';
import { Grid3x3 } from 'lucide-react';
import { useRateCard } from '../../context/RateCardContext';
import { RateCardRecord } from '../../types/rateCard';
import {
  formatCurrencyRandstad,
  formatDateRandstad,
  formatPercentageDrift,
  orderRegions,
} from '../../utils/formatters';

type RateBasis = 'minRate' | 'maxRate' | 'avgRate';

const BASIS_OPTIONS: { value: RateBasis; label: string }[] = [
  { value: 'maxRate', label: 'Max Rate' },
  { value: 'minRate', label: 'Min Rate' },
  { value: 'avgRate', label: 'Average Rate' },
];

/**
 * Discrete colour buckets, not a continuous scale — references/DESIGN.md
 * prohibits gradients. Tints follow the established rgba pattern used for the
 * error surface in FileUploader and the --ghost-border token.
 */
const cellBackground = (percent: number | null): string => {
  if (percent === null) return 'transparent';
  if (percent >= 10) return 'rgba(37, 127, 86, 0.22)';
  if (percent >= 2) return 'rgba(37, 127, 86, 0.10)';
  if (percent <= -10) return 'rgba(224, 15, 15, 0.20)';
  if (percent <= -2) return 'rgba(224, 15, 15, 0.09)';
  return 'rgba(194, 198, 211, 0.15)';
};

const cellColor = (percent: number | null): string => {
  if (percent === null) return '#677E95';
  if (percent >= 2) return '#257F56';
  if (percent <= -2) return '#E00F0F';
  return '#415E7D';
};

export const RegionalRateHeatmap: React.FC = () => {
  const { clientScopedRateCards } = useRateCard();

  const [basePeriod, setBasePeriod] = useState<string>('');
  const [targetPeriod, setTargetPeriod] = useState<string>('');
  const [basis, setBasis] = useState<RateBasis>('maxRate');

  const periods = useMemo(
    () => Array.from(new Set(clientScopedRateCards.map((r) => r.effectiveDate))).sort().reverse(),
    [clientScopedRateCards]
  );

  // Records load asynchronously, so the first render sees an empty list.
  // Derive the shown periods rather than latching state onto that empty state.
  const effectiveBase = basePeriod && periods.includes(basePeriod) ? basePeriod : periods[1] ?? '';
  const effectiveTarget =
    targetPeriod && periods.includes(targetPeriod) ? targetPeriod : periods[0] ?? '';

  const regions = useMemo(() => orderRegions(clientScopedRateCards), [clientScopedRateCards]);

  const rows = useMemo(() => {
    const valueOf = (rec: RateCardRecord | undefined) => (rec ? rec[basis] : undefined);

    const inPeriod = (date: string) => clientScopedRateCards.filter((r) => r.effectiveDate === date);
    const baseCards = inPeriod(effectiveBase);
    const targetCards = inPeriod(effectiveTarget);

    const find = (cards: RateCardRecord[], title: string, region: string) =>
      cards.find((r) => r.jobTitle === title && (r.region || 'Unspecified') === region);

    const titles = Array.from(
      new Set([...baseCards, ...targetCards].map((r) => r.jobTitle))
    ).sort();

    return titles.map((title) => {
      const cells = regions.map((region) => {
        const baseVal = valueOf(find(baseCards, title, region));
        const targetVal = valueOf(find(targetCards, title, region));
        const percent =
          baseVal !== undefined && targetVal !== undefined && baseVal > 0
            ? ((targetVal - baseVal) / baseVal) * 100
            : null;
        return { region, percent, baseVal, targetVal };
      });

      // Trailing raw values, mirroring the 2026 / 2025 columns of the source report
      const firstWithData = cells.find((c) => c.targetVal !== undefined || c.baseVal !== undefined);
      return {
        title,
        cells,
        targetRaw: firstWithData?.targetVal,
        baseRaw: firstWithData?.baseVal,
      };
    });
  }, [clientScopedRateCards, regions, effectiveBase, effectiveTarget, basis]);

  if (periods.length < 2 || regions.length === 0) {
    return (
      <div className="tonal-card">
        <div className="card-header-row">
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Grid3x3 size={20} color="#255CA9" />
              <span>Regional Rate Heatmap</span>
            </h2>
            <span className="app-subtitle">
              Rate movement per role across regions, between two reporting dates
            </span>
          </div>
        </div>
        <div className="tonal-card-sub">
          <span className="text-meta">
            {periods.length < 2
              ? 'Ingest at least two reporting dates to compare rate movement.'
              : 'No regional data in scope yet.'}
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
            <Grid3x3 size={20} color="#255CA9" />
            <span>Regional Rate Heatmap</span>
          </h2>
          <span className="app-subtitle">
            Change in {BASIS_OPTIONS.find((o) => o.value === basis)?.label.toLowerCase()} per role,
            by region, from {formatDateRandstad(effectiveBase)} to {formatDateRandstad(effectiveTarget)}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div>
            <label className="form-label">Rate Basis:</label>
            <select
              className="form-control"
              style={{ width: '150px' }}
              value={basis}
              onChange={(e) => setBasis(e.target.value as RateBasis)}
            >
              {BASIS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">Base Period:</label>
            <select
              className="form-control"
              style={{ width: '170px' }}
              value={effectiveBase}
              onChange={(e) => setBasePeriod(e.target.value)}
            >
              {periods.map((p) => (
                <option key={`hb-${p}`} value={p}>{formatDateRandstad(p)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">Comparison Period:</label>
            <select
              className="form-control"
              style={{ width: '170px' }}
              value={effectiveTarget}
              onChange={(e) => setTargetPeriod(e.target.value)}
            >
              {periods.map((p) => (
                <option key={`ht-${p}`} value={p}>{formatDateRandstad(p)}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="table-container">
        <table className="randstad-table">
          <thead>
            <tr>
              <th>Job Title</th>
              {regions.map((r) => (
                <th key={r} style={{ textAlign: 'right' }}>{r}</th>
              ))}
              <th style={{ textAlign: 'right' }}>{formatDateRandstad(effectiveTarget)}</th>
              <th style={{ textAlign: 'right' }}>{formatDateRandstad(effectiveBase)}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={regions.length + 3} style={{ textAlign: 'center', padding: '32px', color: '#415E7D' }}>
                  No roles found in either selected period.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.title}>
                  <td style={{ fontWeight: 600 }}>{row.title}</td>
                  {row.cells.map((cell) => (
                    <td
                      key={cell.region}
                      style={{
                        textAlign: 'right',
                        fontWeight: 600,
                        backgroundColor: cellBackground(cell.percent),
                        color: cellColor(cell.percent),
                      }}
                    >
                      {/* An em-dash means "no data" — rendering 0% here would
                          wrongly read as "no change". */}
                      {cell.percent === null ? '—' : formatPercentageDrift(cell.percent)}
                    </td>
                  ))}
                  <td style={{ textAlign: 'right' }}>
                    {row.targetRaw !== undefined ? formatCurrencyRandstad(row.targetRaw) : '—'}
                  </td>
                  <td style={{ textAlign: 'right', color: '#677E95' }}>
                    {row.baseRaw !== undefined ? formatCurrencyRandstad(row.baseRaw) : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Colour is a secondary cue; the percentage stays legible in every cell. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '12px', flexWrap: 'wrap' }}>
        <span className="text-meta">Change:</span>
        {[
          { label: 'Down over 10%', pct: -15 },
          { label: 'Down 2–10%', pct: -5 },
          { label: 'Flat within 2%', pct: 0 },
          { label: 'Up 2–10%', pct: 5 },
          { label: 'Up over 10%', pct: 15 },
        ].map((b) => (
          <span key={b.label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span
              style={{
                width: '16px',
                height: '16px',
                borderRadius: '3px',
                backgroundColor: cellBackground(b.pct),
                display: 'inline-block',
              }}
            />
            <span className="text-meta">{b.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
};
