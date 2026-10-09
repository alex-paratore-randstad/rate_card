import React, { useEffect, useMemo, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { useRateCard } from '../../context/RateCardContext';
import {
  computeRateMovement,
  mappingsHaveFamilies,
  MovementCell,
  MovementGrouping,
  NO_FAMILY,
  summarizeMovement,
} from '../../services/rateMovementService';

/**
 * What moved between two rate years, by job family and region.
 *
 * A heatmap rather than a table of rates: the question is where the card got
 * more expensive, and rates in six regions' currencies cannot share a scale
 * while their percentage changes can.
 */

/** Signed, one decimal, with a true minus so columns align. */
const fmt = (v: number): string => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;

/**
 * Seven flat steps, diverging around no change. Blue for a fall and warm for a
 * rise, so direction reads before magnitude. The middle step is a band rather
 * than zero — a 0.4% move is not a finding.
 */
const BUCKETS: { label: string; test: (v: number) => boolean; bg: string; fg: string }[] = [
  { label: '≤ −7%', test: (v) => v <= -7, bg: '#1F4E9C', fg: '#FFFFFF' },
  { label: '−7 to −4', test: (v) => v <= -4, bg: '#4A86E0', fg: '#FFFFFF' },
  { label: '−4 to −1', test: (v) => v < -1, bg: '#A9C8F2', fg: '#001D35' },
  { label: '±1', test: (v) => v <= 1, bg: '#E4E6EA', fg: '#001D35' },
  { label: '+1 to +4', test: (v) => v < 4, bg: '#EDB4A0', fg: '#001D35' },
  { label: '+4 to +7', test: (v) => v < 7, bg: '#CF6545', fg: '#FFFFFF' },
  { label: '≥ +7%', test: () => true, bg: '#7A2E1C', fg: '#FFFFFF' },
];

const bucketFor = (v: number) => BUCKETS.find((b) => b.test(v))!;

const Cell: React.FC<{ cell?: MovementCell; strong?: boolean }> = ({ cell, strong }) => {
  if (!cell) {
    return (
      <td style={{ padding: '3px' }}>
        <div
          title="No rate lines in this region"
          style={{
            background: 'var(--surface-container-low)',
            color: 'var(--on-surface-subtle)',
            borderRadius: '4px',
            padding: '8px 6px',
            textAlign: 'center',
          }}
        >
          —
        </div>
      </td>
    );
  }
  const bucket = bucketFor(cell.change);
  return (
    <td style={{ padding: '3px' }}>
      <div
        title={`${cell.lines} rate line${cell.lines === 1 ? '' : 's'}`}
        style={{
          background: bucket.bg,
          color: bucket.fg,
          borderRadius: '4px',
          padding: '8px 6px',
          textAlign: 'center',
          fontWeight: strong ? 700 : 600,
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
        }}
      >
        {fmt(cell.change)}
      </div>
    </td>
  );
};

export const RateMovementReport: React.FC = () => {
  const { scopedRateCards, titleMappings, filters } = useRateCard();

  const years = useMemo(
    () => Array.from(new Set(scopedRateCards.map((r) => r.rateYear))).sort(),
    [scopedRateCards]
  );

  // Defaults to the two latest years, and follows the data until the reader
  // picks something — records arrive after first render.
  const [picked, setPicked] = useState<{ from: string; to: string } | null>(null);
  const fromYear = picked && years.includes(picked.from) ? picked.from : years[years.length - 2];
  const toYear = picked && years.includes(picked.to) ? picked.to : years[years.length - 1];

  const hasFamilies = mappingsHaveFamilies(titleMappings);
  const [grouping, setGrouping] = useState<MovementGrouping>(hasFamilies ? 'family' : 'title');
  useEffect(() => {
    if (!hasFamilies) setGrouping('title');
  }, [hasFamilies]);

  const [showAll, setShowAll] = useState(false);
  const ROW_CAP = 25;

  const movement = useMemo(
    () =>
      fromYear && toYear && fromYear !== toYear
        ? computeRateMovement(scopedRateCards, fromYear, toYear, titleMappings, grouping)
        : null,
    [scopedRateCards, fromYear, toYear, titleMappings, grouping]
  );

  const scopeNote =
    filters.client === 'ALL' && filters.country === 'ALL'
      ? 'every ingested card'
      : [filters.client, filters.country].filter((v) => v !== 'ALL').join(' · ');

  const header = (
    <div className="card-header-row">
      <div>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <TrendingUp size={20} color="#255CA9" />
          <span>Rate Movement</span>
        </h2>
        <span className="app-subtitle">
          Change in the card maximum (NTE) by {grouping === 'family' ? 'job family' : 'job title'}{' '}
          and region · {scopeNote} · needs no Domo connection
        </span>
      </div>
    </div>
  );

  if (years.length < 2) {
    return (
      <div className="tonal-card">
        {header}
        <div className="tonal-card-sub">
          <span className="text-meta">
            {years.length === 0
              ? 'No rate card data in scope — ingest a report, or widen the client and country filter.'
              : `Only ${years[0]} is loaded in this scope. Movement needs a second rate year to compare against.`}
          </span>
        </div>
      </div>
    );
  }

  const rows = movement ? (showAll ? movement.rows : movement.rows.slice(0, ROW_CAP)) : [];
  const headline = movement ? summarizeMovement(movement, fmt) : null;

  return (
    <div className="tonal-card">
      {header}

      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label className="form-label" style={{ margin: 0 }}>From</label>
          <select
            className="form-control"
            style={{ width: '110px' }}
            value={fromYear}
            onChange={(e) => setPicked({ from: e.target.value, to: toYear })}
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <label className="form-label" style={{ margin: 0 }}>to</label>
          <select
            className="form-control"
            style={{ width: '110px' }}
            value={toYear}
            onChange={(e) => setPicked({ from: fromYear, to: e.target.value })}
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label className="form-label" style={{ margin: 0 }}>Rows</label>
          <select
            className="form-control"
            style={{ width: '160px' }}
            value={grouping}
            onChange={(e) => setGrouping(e.target.value as MovementGrouping)}
          >
            <option value="family" disabled={!hasFamilies}>Job family</option>
            <option value="title">Job title</option>
          </select>
        </div>

        {!hasFamilies && (
          <span className="text-meta">
            Grouping by job family needs families on the standard title list, which the current
            list does not carry. Titles are grouped by their standard title.
          </span>
        )}
      </div>

      {fromYear === toYear || !movement ? (
        <div className="tonal-card-sub">
          <span className="text-meta">Pick two different years to compare.</span>
        </div>
      ) : movement.rows.length === 0 ? (
        <div className="tonal-card-sub">
          <span className="text-meta">
            No rate line appears in both {fromYear} and {toYear} in this scope, so nothing can be
            compared. A line is one title for one client, country, and labor type.
          </span>
        </div>
      ) : (
        <>
          {headline && (
            <h3 style={{ margin: '0 0 4px', fontSize: '1.15rem', lineHeight: 1.35 }}>{headline}</h3>
          )}
          <span className="app-subtitle" style={{ display: 'block', marginBottom: '12px' }}>
            Average change in the recommended NTE, {fromYear} to {toYear}, per rate line
          </span>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', minWidth: '720px' }}>
              <thead>
                <tr>
                  <th
                    style={{
                      textAlign: 'left',
                      verticalAlign: 'bottom',
                      padding: '4px 8px 6px 0',
                      fontWeight: 400,
                      color: 'var(--on-surface-muted)',
                    }}
                  >
                    {grouping === 'family' ? 'Job family' : 'Job title'}
                  </th>
                  {[...movement.regions, 'All regions'].map((region) => {
                    const total =
                      region === 'All regions' ? movement.overall : movement.regionTotals.get(region);
                    return (
                      <th key={region} style={{ padding: '4px 3px 6px', textAlign: 'center', minWidth: '96px' }}>
                        <div style={{ fontWeight: region === 'All regions' ? 700 : 600 }}>{region}</div>
                        <div
                          style={{ fontWeight: 400, color: 'var(--on-surface-muted)', fontVariantNumeric: 'tabular-nums' }}
                          title={total ? `${total.lines} rate lines` : undefined}
                        >
                          {total ? fmt(total.change) : '—'}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label}>
                    <td
                      style={{
                        padding: '3px 12px 3px 0',
                        fontWeight: 500,
                        whiteSpace: 'nowrap',
                        color: row.label === NO_FAMILY ? 'var(--on-surface-subtle)' : 'var(--on-surface)',
                        fontStyle: row.label === NO_FAMILY ? 'italic' : 'normal',
                      }}
                    >
                      {row.label}
                    </td>
                    {movement.regions.map((region) => (
                      <Cell key={region} cell={row.cells.get(region)} />
                    ))}
                    <Cell cell={row.overall} strong />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {movement.rows.length > ROW_CAP && (
            <button className="btn-secondary" style={{ marginTop: '10px' }} onClick={() => setShowAll((v) => !v)}>
              {showAll ? `Show the top ${ROW_CAP}` : `Show all ${movement.rows.length} rows`}
            </button>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: '14px' }}>
            <span className="text-meta" style={{ marginRight: '6px' }}>Change in NTE</span>
            {BUCKETS.map((b) => (
              <span
                key={b.label}
                style={{
                  background: b.bg,
                  color: b.fg,
                  borderRadius: '3px',
                  padding: '2px 8px',
                  fontSize: '0.8rem',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {b.label}
              </span>
            ))}
            <span className="text-meta" style={{ marginLeft: '8px' }}>— no rate lines in that region</span>
          </div>

          <div className="tonal-card-sub" style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span className="text-meta">
              Each line is one title for one client, country, and labor type, compared only against
              itself, so a title added or dropped between years does not move the average. Every line
              counts once: the card carries no volume, so this is not spend-weighted.
            </span>
            <span className="text-meta">
              Compared {movement.overall?.lines ?? 0} line{movement.overall?.lines === 1 ? '' : 's'}.
              Not compared: {movement.onlyInFrom} only in {fromYear}, {movement.onlyInTo} only in {toYear}
              {movement.unusable ? `, ${movement.unusable} with no usable maximum` : ''}.
            </span>
          </div>
        </>
      )}
    </div>
  );
};
