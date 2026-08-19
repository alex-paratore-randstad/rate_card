import React, { useMemo, useState } from 'react';
import { Search, TableProperties } from 'lucide-react';
import { useRateCard } from '../../context/RateCardContext';
import { formatDateRandstad } from '../../utils/formatters';

/** Plain money for a dense grid; the currency is stated once in the subtitle. */
const money = (amount: number | undefined): string =>
  amount === undefined ? '—' : `$${amount.toFixed(2)}`;

/**
 * Variance colouring runs the opposite way to a normal heatmap: a rate coming
 * DOWN is a saving, so negative variance is green and an increase is amber.
 * Discrete fills rather than a gradient, per references/DESIGN.md.
 */
const varianceBackground = (percent: number | null): string => {
  if (percent === null) return 'transparent';
  if (percent <= -10) return 'rgba(37, 127, 86, 0.30)';
  if (percent < 0) return 'rgba(37, 127, 86, 0.13)';
  if (percent === 0) return 'rgba(194, 198, 211, 0.15)';
  if (percent < 10) return 'rgba(233, 162, 4, 0.22)';
  return 'rgba(233, 162, 4, 0.42)';
};

const varianceColor = (percent: number | null): string => {
  if (percent === null) return '#677E95';
  if (percent < 0) return '#257F56';
  if (percent === 0) return '#415E7D';
  return '#001D35';
};

interface VarianceRow {
  jobTitle: string;
  laborType: string;
  baseMin?: number;
  baseMax?: number;
  targetMin?: number;
  targetMax?: number;
  variance: number | null;
}

export const PayVarianceTable: React.FC = () => {
  const { clientScopedRateCards } = useRateCard();

  const [basePeriod, setBasePeriod] = useState<string>('');
  const [targetPeriod, setTargetPeriod] = useState<string>('');
  const [search, setSearch] = useState<string>('');

  const periods = useMemo(
    () => Array.from(new Set(clientScopedRateCards.map((r) => r.effectiveDate))).sort().reverse(),
    [clientScopedRateCards]
  );

  // Derived rather than latched: records arrive asynchronously, so seeding
  // useState from this list would pin whatever was present on first render.
  const effectiveBase = basePeriod && periods.includes(basePeriod) ? basePeriod : periods[1] ?? '';
  const effectiveTarget =
    targetPeriod && periods.includes(targetPeriod) ? targetPeriod : periods[0] ?? '';

  const { rows, aggregated } = useMemo(() => {
    /**
     * One output row per job title + labor type. A title can hold several
     * records in a period (one per region, for instance), so rates are averaged
     * within the key rather than picking an arbitrary first match.
     */
    const collect = (date: string) => {
      const acc = new Map<
        string,
        { jobTitle: string; laborType: string; minSum: number; maxSum: number; count: number }
      >();
      for (const r of clientScopedRateCards) {
        if (r.effectiveDate !== date) continue;
        const laborType = r.laborType || '';
        const key = `${r.jobTitle}||${laborType}`;
        const entry =
          acc.get(key) ?? { jobTitle: r.jobTitle, laborType, minSum: 0, maxSum: 0, count: 0 };
        entry.minSum += r.minRate;
        entry.maxSum += r.maxRate;
        entry.count += 1;
        acc.set(key, entry);
      }
      return acc;
    };

    const baseMap = collect(effectiveBase);
    const targetMap = collect(effectiveTarget);
    const collapsed = [...baseMap.values(), ...targetMap.values()].some((e) => e.count > 1);

    const keys = Array.from(new Set([...baseMap.keys(), ...targetMap.keys()]));

    const built: VarianceRow[] = keys.map((key) => {
      const b = baseMap.get(key);
      const t = targetMap.get(key);
      const identity = b ?? t!;

      const baseMax = b ? b.maxSum / b.count : undefined;
      const targetMax = t ? t.maxSum / t.count : undefined;

      return {
        jobTitle: identity.jobTitle,
        laborType: identity.laborType,
        baseMin: b ? b.minSum / b.count : undefined,
        baseMax,
        targetMin: t ? t.minSum / t.count : undefined,
        targetMax,
        // Matches =(F2-D2)/D2 — measured on Max Pay, against the base period.
        variance:
          baseMax !== undefined && targetMax !== undefined && baseMax > 0
            ? ((targetMax - baseMax) / baseMax) * 100
            : null,
      };
    });

    const term = search.trim().toLowerCase();
    const filtered = term
      ? built.filter(
          (r) =>
            r.jobTitle.toLowerCase().includes(term) || r.laborType.toLowerCase().includes(term)
        )
      : built;

    filtered.sort((a, b) => a.jobTitle.localeCompare(b.jobTitle, undefined, { numeric: true }));
    return { rows: filtered, aggregated: collapsed };
  }, [clientScopedRateCards, effectiveBase, effectiveTarget, search]);

  const currency = clientScopedRateCards[0]?.currency ?? 'USD';

  if (periods.length < 2) {
    return (
      <div className="tonal-card">
        <div className="card-header-row">
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <TableProperties size={20} color="#255CA9" />
              <span>Pay Rate Variance</span>
            </h2>
            <span className="app-subtitle">
              Min and max pay per role across two reports, with variance on max pay
            </span>
          </div>
        </div>
        <div className="tonal-card-sub">
          <span className="text-meta">
            {periods.length === 0
              ? 'No rate card data yet — ingest a report to get started.'
              : 'Only one reporting date is loaded. Ingest a second report to compare against it.'}
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
            <TableProperties size={20} color="#255CA9" />
            <span>Pay Rate Variance</span>
          </h2>
          <span className="app-subtitle">
            {rows.length} roles · variance measured on max pay, {currency} · a negative variance is
            a rate decrease
          </span>
          {aggregated && (
            <div style={{ marginTop: '6px' }}>
              <span className="status-pill info">
                Some roles hold several records per date — rates shown are averaged per role
              </span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', width: '220px' }}>
            <Search size={16} color="#415E7D" style={{ position: 'absolute', left: '12px', top: '12px' }} />
            <input
              type="text"
              className="form-control"
              style={{ paddingLeft: '36px' }}
              placeholder="Search job title or labor type..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div>
            <label className="form-label">Base Report:</label>
            <select
              className="form-control"
              style={{ width: '170px' }}
              value={effectiveBase}
              onChange={(e) => setBasePeriod(e.target.value)}
            >
              {periods.map((p) => (
                <option key={`pvb-${p}`} value={p}>{formatDateRandstad(p)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">Comparison Report:</label>
            <select
              className="form-control"
              style={{ width: '170px' }}
              value={effectiveTarget}
              onChange={(e) => setTargetPeriod(e.target.value)}
            >
              {periods.map((p) => (
                <option key={`pvt-${p}`} value={p}>{formatDateRandstad(p)}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="table-container">
        <table className="randstad-table">
          <thead>
            <tr>
              <th>Job Titles</th>
              <th>Labor Type</th>
              {/* Both reports carry the same measure names, so each pair is
                  labelled with its own date rather than repeating the header. */}
              <th style={{ textAlign: 'right' }}>
                Min Pay
                <div className="text-meta">{formatDateRandstad(effectiveBase)}</div>
              </th>
              <th style={{ textAlign: 'right' }}>
                Max Pay
                <div className="text-meta">{formatDateRandstad(effectiveBase)}</div>
              </th>
              <th style={{ textAlign: 'right' }}>
                Min Pay
                <div className="text-meta">{formatDateRandstad(effectiveTarget)}</div>
              </th>
              <th style={{ textAlign: 'right' }}>
                Max Pay
                <div className="text-meta">{formatDateRandstad(effectiveTarget)}</div>
              </th>
              <th style={{ textAlign: 'right' }}>Variance</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '32px', color: '#415E7D' }}>
                  No roles match your search.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={`${row.jobTitle}||${row.laborType}`}>
                  <td style={{ fontWeight: 600 }}>{row.jobTitle}</td>
                  <td>{row.laborType || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{money(row.baseMin)}</td>
                  <td style={{ textAlign: 'right' }}>{money(row.baseMax)}</td>
                  <td style={{ textAlign: 'right' }}>{money(row.targetMin)}</td>
                  <td style={{ textAlign: 'right' }}>{money(row.targetMax)}</td>
                  <td
                    style={{
                      textAlign: 'right',
                      fontWeight: 600,
                      backgroundColor: varianceBackground(row.variance),
                      color: varianceColor(row.variance),
                    }}
                  >
                    {/* An em-dash means the role is missing from one report;
                        0.00% would wrongly read as "no change". */}
                    {row.variance === null ? '—' : `${row.variance.toFixed(2)}%`}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '12px', flexWrap: 'wrap' }}>
        <span className="text-meta">Variance:</span>
        {[
          { label: 'Down over 10%', pct: -15 },
          { label: 'Down under 10%', pct: -5 },
          { label: 'No change', pct: 0 },
          { label: 'Up under 10%', pct: 5 },
          { label: 'Up over 10%', pct: 15 },
        ].map((b) => (
          <span key={b.label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span
              style={{
                width: '16px',
                height: '16px',
                borderRadius: '3px',
                backgroundColor: varianceBackground(b.pct),
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
