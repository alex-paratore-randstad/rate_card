import React, { useMemo, useState } from 'react';
import { DatabaseZap, Target } from 'lucide-react';
import { useRateCard } from '../../context/RateCardContext';
import { computeConcentration, RoleBubble } from '../../services/rateConcentrationService';

/**
 * Which roles carry the cost of a rate change.
 *
 * The change comes from the uploaded cards and the spend from the Domo actuals,
 * so this is the one report under Reports that needs the connection. The
 * shaded corner is the watch list: roles that rose faster than the portfolio
 * and carry more spend than the median role — where agreeing a rate with the
 * supplier first is worth the most.
 */

const pct = (v: number): string => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;

/** Compact USD for an axis or a list: $1.72M, $840K. */
const usd = (v: number): string => {
  const abs = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${Math.round(abs / 1e3)}K`;
  return `${sign}$${Math.round(abs)}`;
};

/** Axis ticks at a round step, covering [lo, hi]. */
const ticks = (lo: number, hi: number, target: number): number[] => {
  const raw = (hi - lo) / target || 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.001; v += step) out.push(+v.toFixed(10));
  if (out[out.length - 1] < hi) out.push(out[out.length - 1] + step);
  return out;
};

const WARM = '#CF6545';
const WARM_EDGE = '#7A2E1C';
const GREY = '#BCC3CC';

const W = 720;
const H = 420;
const M = { top: 16, right: 20, bottom: 52, left: 64 };

const BubbleChart: React.FC<{
  roles: RoleBubble[];
  watch: Set<string>;
  portfolioChange: number;
  spendThreshold: number;
}> = ({ roles, watch, portfolioChange, spendThreshold }) => {
  const changes = roles.map((r) => r.change);
  const xTicks = ticks(Math.min(0, ...changes) - 1, Math.max(portfolioChange, ...changes) + 1, 6);
  const yTicks = ticks(0, Math.max(...roles.map((r) => r.spend)) * 1.08, 4);
  const [x0, x1] = [xTicks[0], xTicks[xTicks.length - 1]];
  const y1 = yTicks[yTicks.length - 1];

  const x = (v: number) => M.left + ((v - x0) / (x1 - x0)) * (W - M.left - M.right);
  const y = (v: number) => H - M.bottom - (v / y1) * (H - M.top - M.bottom);

  // Area, not radius, is proportional to workers — a radius scale makes a
  // role with twice the workers look four times the size.
  const maxWorkers = Math.max(1, ...roles.map((r) => r.activeWorkers));
  const radius = (n: number) => 4 + 22 * Math.sqrt(n / maxWorkers);

  // Label every watch-list role and the three largest by spend; labelling all
  // of them would bury the chart.
  const labelled = new Set([...watch, ...roles.slice(0, 3).map((r) => r.role)]);

  // Small bubbles drawn last, so a large one never hides them.
  const order = [...roles].sort((a, b) => b.activeWorkers - a.activeWorkers);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img"
      aria-label="Each role's change in the card maximum against its spend">
      {/* Watch list zone */}
      <rect
        x={x(portfolioChange)}
        y={M.top}
        width={Math.max(0, W - M.right - x(portfolioChange))}
        height={Math.max(0, y(spendThreshold) - M.top)}
        fill={WARM}
        opacity={0.12}
      />
      <text x={W - M.right - 8} y={M.top + 18} textAnchor="end" fontWeight={700} fontSize={13} fill="var(--on-surface)">
        Watch list
      </text>

      {/* Grid and axes */}
      {xTicks.map((t) => (
        <g key={`x${t}`}>
          <line x1={x(t)} x2={x(t)} y1={M.top} y2={H - M.bottom}
            stroke={t === 0 ? '#9AA5B1' : 'rgba(194,198,211,0.45)'} />
          <text x={x(t)} y={H - M.bottom + 18} textAnchor="middle" fontSize={13} fill="var(--on-surface-muted)">
            {t === 0 ? '0%' : pct(t).replace('.0%', '%')}
          </text>
        </g>
      ))}
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="rgba(194,198,211,0.45)" />
          <text x={M.left - 8} y={y(t) + 4} textAnchor="end" fontSize={13} fill="var(--on-surface-muted)">
            {usd(t).replace('.00', '')}
          </text>
        </g>
      ))}
      <text x={(M.left + W - M.right) / 2} y={H - 10} textAnchor="middle" fontSize={13} fill="var(--on-surface-muted)">
        Change in recommended NTE, spend-weighted
      </text>

      {/* Reference lines */}
      <line x1={x(portfolioChange)} x2={x(portfolioChange)} y1={M.top} y2={H - M.bottom} stroke="#415E7D" strokeWidth={1.25} />
      <text x={x(portfolioChange) + 6} y={H - M.bottom - 8} fontSize={13} fill="var(--on-surface-muted)">
        Portfolio avg {pct(portfolioChange)}
      </text>
      <line x1={M.left} x2={W - M.right} y1={y(spendThreshold)} y2={y(spendThreshold)} stroke="#415E7D" strokeWidth={1.25} />
      {/* Inside the plot rather than on the axis, where it would collide with a tick. */}
      <text x={M.left + 6} y={y(spendThreshold) - 6} fontSize={12} fontWeight={700} fill="var(--on-surface)"
        stroke="var(--surface-container-lowest)" strokeWidth={4} paintOrder="stroke">
        Median role spend {usd(spendThreshold)}
      </text>

      {/* Bubbles */}
      {order.map((r) => {
        const hot = watch.has(r.role);
        return (
          <circle key={r.role} cx={x(r.change)} cy={y(r.spend)} r={radius(r.activeWorkers)}
            fill={hot ? WARM : GREY} fillOpacity={hot ? 0.95 : 0.75}
            stroke={hot ? WARM_EDGE : '#FFFFFF'} strokeWidth={1.25}>
            <title>
              {`${r.role}\nChange in NTE ${pct(r.change)}\nSpend ${usd(r.spend)}\n${r.activeWorkers} active worker${r.activeWorkers === 1 ? '' : 's'}\nImpact ${usd(r.impact)}`}
            </title>
          </circle>
        );
      })}

      {/* Labels, haloed so they read over gridlines and other bubbles */}
      {roles.filter((r) => labelled.has(r.role)).map((r) => {
        const cx = x(r.change);
        const rightSide = cx < W - 170;
        const offset = radius(r.activeWorkers) + 6;
        return (
          <text key={`l${r.role}`} x={rightSide ? cx + offset : cx - offset} y={y(r.spend) + 4}
            textAnchor={rightSide ? 'start' : 'end'} fontSize={13.5} fill="var(--on-surface)"
            stroke="var(--surface-container-lowest)" strokeWidth={4} paintOrder="stroke" strokeLinejoin="round">
            {r.role}
          </text>
        );
      })}
    </svg>
  );
};

export const RateConcentrationReport: React.FC = () => {
  const {
    scopedRateCards,
    titleMappings,
    clientAliases,
    titleAliases,
    assignmentActuals,
    actualsLoading,
    loadAssignmentActuals,
  } = useRateCard();

  const years = useMemo(
    () => Array.from(new Set(scopedRateCards.map((r) => r.rateYear))).sort(),
    [scopedRateCards]
  );
  const [picked, setPicked] = useState<{ from: string; to: string } | null>(null);
  const fromYear = picked && years.includes(picked.from) ? picked.from : years[years.length - 2];
  const toYear = picked && years.includes(picked.to) ? picked.to : years[years.length - 1];

  const result = useMemo(
    () =>
      assignmentActuals && fromYear && toYear && fromYear !== toYear
        ? computeConcentration(scopedRateCards, fromYear, toYear, titleMappings, assignmentActuals, clientAliases, titleAliases)
        : null,
    [scopedRateCards, fromYear, toYear, titleMappings, assignmentActuals, clientAliases, titleAliases]
  );

  const watch = useMemo(() => new Set(result?.watchList.map((r) => r.role) ?? []), [result]);
  const share = result && result.totalImpact > 0 ? (result.watchImpact / result.totalImpact) * 100 : null;

  const header = (
    <div className="card-header-row">
      <div>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Target size={20} color="#255CA9" />
          <span>Rate Concentration</span>
        </h2>
        <span className="app-subtitle">
          Each bubble is a role: change in NTE from the uploaded cards across, spend from Domo up,
          bubble area = active workers
        </span>
      </div>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        {years.length >= 2 && (
          <>
            <select className="form-control" style={{ width: '100px' }} value={fromYear}
              onChange={(e) => setPicked({ from: e.target.value, to: toYear })}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <span className="text-meta">to</span>
            <select className="form-control" style={{ width: '100px' }} value={toYear}
              onChange={(e) => setPicked({ from: fromYear, to: e.target.value })}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </>
        )}
        <button className="btn-teal" onClick={loadAssignmentActuals} disabled={actualsLoading}>
          <DatabaseZap size={16} />
          <span>{actualsLoading ? 'Loading actuals…' : assignmentActuals ? 'Reload actuals' : 'Load actuals'}</span>
        </button>
      </div>
    </div>
  );

  const notice = (text: React.ReactNode) => (
    <div className="tonal-card">
      {header}
      <div className="tonal-card-sub"><span className="text-meta">{text}</span></div>
    </div>
  );

  if (years.length < 2) {
    return notice(
      years.length === 0
        ? 'No rate card data in scope — ingest a report, or widen the client and country filter.'
        : `Only ${years[0]} is loaded in this scope. The change in NTE needs a second rate year.`
    );
  }
  if (assignmentActuals === null) {
    return notice(
      'Spend comes from the Domo assignment actuals, which are fetched on demand. Load them to place each role.'
    );
  }
  if (fromYear === toYear) return notice('Pick two different years to compare.');
  if (!result || result.roles.length === 0) {
    return notice(
      <>
        No role on both cards matched any spend in the actuals.
        {result?.unresolvedClients.length
          ? ` ${result.unresolvedClients.length} card client(s) are not matched to a Domo client yet — resolve them under Data → Clients.`
          : ' Check the title matches under Data → Titles.'}
      </>
    );
  }

  return (
    <div className="tonal-card">
      {header}

      {share !== null && result.watchList.length > 0 ? (
        <h3 style={{ margin: '0 0 12px', fontSize: '1.15rem', lineHeight: 1.35 }}>
          {result.watchList.length === 1 ? 'One role carries' : `${result.watchList.length} roles carry`}{' '}
          {Math.round(share)}% of the cost increase; agree their rates with suppliers first
        </h3>
      ) : (
        <h3 style={{ margin: '0 0 12px', fontSize: '1.15rem' }}>
          No role is both above the portfolio change and above median spend
        </h3>
      )}

      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 560px', minWidth: 0 }}>
          <div className="text-meta" style={{ marginBottom: '4px' }}>Spend to date (USD)</div>
          <BubbleChart roles={result.roles} watch={watch} portfolioChange={result.portfolioChange}
            spendThreshold={result.spendThreshold} />
        </div>

        <div className="tonal-card-sub" style={{ flex: '0 1 320px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <strong style={{ fontSize: '1rem' }}>Watch list · cost impact</strong>
          {result.watchList.length === 0 && <span className="text-meta">Nothing in the shaded zone.</span>}
          {result.watchList.map((r) => (
            <div key={r.role} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}
              title={`${pct(r.change)} on ${usd(r.spend)} of spend`}>
              <span>{r.role}</span>
              <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{usd(r.impact)}</strong>
            </div>
          ))}
          {result.watchList.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', borderTop: '1px solid var(--ghost-border)', paddingTop: '8px', marginTop: '4px' }}>
              <strong>{result.watchList.length === 1 ? 'One role' : `${result.watchList.length} roles`}</strong>
              <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                {usd(result.watchImpact)}{share !== null ? ` · ${Math.round(share)}%` : ''}
              </strong>
            </div>
          )}
          <span className="text-meta" style={{ marginTop: '4px' }}>
            Of {usd(result.totalImpact)} across {result.roles.length} roles
          </span>
        </div>
      </div>

      <div className="tonal-card-sub" style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span className="text-meta">
          {result.fromYear} to {result.toYear}. Change is each role's card lines compared against
          themselves, weighted by their spend. Spend is bill rate × hours to date, in USD — the
          actuals have no reporting month, so it is not trailing twelve months. Cost impact is spend ×
          change. The vertical line is the spend-weighted portfolio change; the horizontal line is
          the median role's spend.
        </span>
        <span className="text-meta">
          Plotted {usd(result.totalSpend)} of spend.
          {result.unmatchedSpend > 0 && ` ${usd(result.unmatchedSpend)} in the same clients and countries matched no title on both cards.`}
          {result.excluded.filter((e) => e.reason !== 'title not on both cards').map((e) => ` ${e.count} row(s) left out: ${e.reason}.`).join('')}
          {result.rolesWithoutSpend.length > 0 && ` ${result.rolesWithoutSpend.length} role(s) moved but matched no spend.`}
          {result.unresolvedClients.length > 0 && ` Card clients not matched to Domo: ${result.unresolvedClients.join(', ')}.`}
        </span>
      </div>
    </div>
  );
};
