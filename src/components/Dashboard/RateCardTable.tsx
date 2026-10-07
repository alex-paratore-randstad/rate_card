import React, { useMemo, useState } from 'react';
import { Search, TableProperties, Plus, X } from 'lucide-react';
import { useRateCard } from '../../context/RateCardContext';
import { formatDateRandstad } from '../../utils/formatters';

/**
 * The uploaded rate card, read across however many years are loaded.
 *
 * This replaced a report that only knew how to do one thing: compare two rate
 * years. Below two it rendered nothing at all — a single uploaded card, which
 * is the ordinary first-day state, showed the words "Only one rate year is
 * loaded" and no data. The data was there and the screen refused to show it
 * because it could not compute the one number it was built around.
 *
 * So the table comes first and variance is what happens when there is a second
 * year to compute it from. One year is a rate card. Two or more is a rate card
 * with variance between consecutive years, which is a column, not a mode.
 */

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

/** Percent change, or null when either end is missing or the base is zero. */
const change = (from: number | undefined, to: number | undefined): number | null =>
  from !== undefined && to !== undefined && from > 0 ? ((to - from) / from) * 100 : null;

interface YearCell {
  min: number;
  max: number;
  /** How many card records were averaged into this cell. */
  count: number;
}

interface TitleRow {
  jobTitle: string;
  laborType: string;
  byYear: Map<string, YearCell>;
}

export const RateCardTable: React.FC = () => {
  const { scopedRateCards } = useRateCard();

  /**
   * Years the reader has set aside, rather than the years they have chosen.
   *
   * Storing the removals and deriving the selection means a year that arrives
   * after first render — records load asynchronously — is shown rather than
   * silently missing, which is what latching the selection into state would
   * have done.
   */
  const [hiddenYears, setHiddenYears] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState<string>('');

  // Ascending, so year-over-year reads left to right like the calendar.
  const years = useMemo(
    () => Array.from(new Set(scopedRateCards.map((r) => r.rateYear))).sort(),
    [scopedRateCards]
  );

  const shownYears = years.filter((y) => !hiddenYears.has(y));

  /** When each year was last uploaded — shown so a re-upload is visible. */
  const uploadedByYear = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of scopedRateCards) {
      const seen = map.get(r.rateYear);
      if (!seen || r.uploadedAt > seen) map.set(r.rateYear, r.uploadedAt);
    }
    return map;
  }, [scopedRateCards]);

  const { rows, aggregated } = useMemo(() => {
    /**
     * One output row per job title + labor type. A title can hold several
     * records in a year — one per region, for instance — so rates are averaged
     * within the key rather than picking an arbitrary first match.
     */
    const acc = new Map<
      string,
      {
        jobTitle: string;
        laborType: string;
        sums: Map<string, { minSum: number; maxSum: number; count: number }>;
      }
    >();
    const shown = new Set(shownYears);

    for (const r of scopedRateCards) {
      if (!shown.has(r.rateYear)) continue;
      const laborType = r.laborType || '';
      const key = `${r.jobTitle}||${laborType}`;
      const entry = acc.get(key) ?? { jobTitle: r.jobTitle, laborType, sums: new Map() };
      const cell = entry.sums.get(r.rateYear) ?? { minSum: 0, maxSum: 0, count: 0 };
      cell.minSum += r.minRate;
      cell.maxSum += r.maxRate;
      cell.count += 1;
      entry.sums.set(r.rateYear, cell);
      acc.set(key, entry);
    }

    let collapsed = false;
    const built: TitleRow[] = Array.from(acc.values()).map((entry) => {
      const byYear = new Map<string, YearCell>();
      for (const [year, cell] of entry.sums) {
        if (cell.count > 1) collapsed = true;
        byYear.set(year, {
          min: cell.minSum / cell.count,
          max: cell.maxSum / cell.count,
          count: cell.count,
        });
      }
      return { jobTitle: entry.jobTitle, laborType: entry.laborType, byYear };
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
  }, [scopedRateCards, shownYears.join('|'), search]);

  /** "uploaded 19 August 2026" — the tracked upload date, made visible. */
  const uploadNote = (year: string): string | null => {
    const at = uploadedByYear.get(year);
    return at ? `uploaded ${formatDateRandstad(at.slice(0, 10))}` : null;
  };

  const toggleYear = (year: string) =>
    setHiddenYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      // Never hide the last one: an empty table is not a view of anything.
      else if (shownYears.length > 1) next.add(year);
      return next;
    });

  if (years.length === 0) {
    return (
      <div className="tonal-card">
        <div className="card-header-row">
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <TableProperties size={20} color="#255CA9" />
              <span>Rate Card</span>
            </h2>
            <span className="app-subtitle">Min and max pay per role, by rate year</span>
          </div>
        </div>
        <div className="tonal-card-sub">
          <span className="text-meta">
            No rate card data yet — ingest a report to get started.
          </span>
        </div>
      </div>
    );
  }

  const columnCount = 2 + shownYears.reduce((n, _y, i) => n + (i === 0 ? 2 : 4), 0);

  return (
    <div className="tonal-card">
      <div className="card-header-row">
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <TableProperties size={20} color="#255CA9" />
            <span>Rate Card</span>
          </h2>
          <span className="app-subtitle">
            {rows.length} role{rows.length === 1 ? '' : 's'} ·{' '}
            {shownYears.length === 1
              ? `rate year ${shownYears[0]}, USD`
              : `${shownYears.length} rate years, USD · variance against the previous year shown, ` +
                'and a negative variance is a rate decrease'}
          </span>
          {aggregated && (
            <div style={{ marginTop: '6px' }}>
              <span className="status-pill info">
                Some roles hold several records in a year — rates shown are averaged per role
              </span>
            </div>
          )}
        </div>

        <div style={{ position: 'relative', width: '240px' }}>
          <Search
            size={16}
            color="#415E7D"
            style={{ position: 'absolute', left: '12px', top: '12px' }}
          />
          <input
            type="text"
            className="form-control"
            style={{ paddingLeft: '36px' }}
            placeholder="Search job title or labor type..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Year chips. Every loaded year is listed; the ones in the table carry a
          dismiss, the ones set aside carry an add, so the control shows what is
          available rather than hiding it behind a menu. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          flexWrap: 'wrap',
          marginBottom: '16px',
        }}
      >
        <span className="form-label" style={{ margin: 0 }}>
          Rate years:
        </span>
        {years.map((year) => {
          const shown = !hiddenYears.has(year);
          const locked = shown && shownYears.length === 1;
          return (
            <button
              key={year}
              onClick={() => toggleYear(year)}
              disabled={locked}
              title={
                locked
                  ? 'At least one rate year has to stay in the table'
                  : shown
                  ? `Remove ${year} from the table`
                  : `Add ${year} to the table`
              }
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '5px 12px',
                borderRadius: '14px',
                fontSize: '0.8rem',
                fontWeight: 600,
                fontFamily: 'var(--font-heading)',
                cursor: locked ? 'default' : 'pointer',
                border: shown ? 'none' : '1px dashed var(--outline-variant, #C2C6D3)',
                backgroundColor: shown ? 'rgba(37, 92, 169, 0.12)' : 'transparent',
                color: shown ? 'var(--randstad-blue-primary)' : '#677E95',
                opacity: locked ? 0.7 : 1,
              }}
            >
              {shown ? <X size={13} /> : <Plus size={13} />}
              <span>{year}</span>
            </button>
          );
        })}
      </div>

      {years.length === 1 && (
        <div style={{ marginBottom: '14px' }}>
          <span className="text-meta">
            One rate year is loaded. Ingest a file carrying another year and a variance column
            appears beside it.
          </span>
        </div>
      )}

      <div className="table-container">
        <table className="randstad-table">
          <thead>
            <tr>
              <th rowSpan={2}>Job Titles</th>
              <th rowSpan={2}>Labor Type</th>
              {shownYears.map((year, i) => (
                <th
                  key={`grp-${year}`}
                  colSpan={i === 0 ? 2 : 4}
                  style={{
                    textAlign: 'center',
                    borderLeft: i === 0 ? undefined : '1px solid var(--outline-variant, #E3E5EC)',
                  }}
                >
                  {year}
                  {uploadNote(year) && <div className="text-meta">{uploadNote(year)}</div>}
                </th>
              ))}
            </tr>
            <tr>
              {shownYears.map((year, i) => (
                <React.Fragment key={`sub-${year}`}>
                  <th
                    style={{
                      textAlign: 'right',
                      borderLeft: i === 0 ? undefined : '1px solid var(--outline-variant, #E3E5EC)',
                    }}
                  >
                    Min Pay
                  </th>
                  <th style={{ textAlign: 'right' }}>Max Pay</th>
                  {i > 0 && (
                    <>
                      {/* Both measures, not max alone. A card whose minimum
                          moved while its maximum held is a real change that a
                          max-only variance reports as 0.00%. */}
                      <th style={{ textAlign: 'right' }}>Min Var</th>
                      <th style={{ textAlign: 'right' }}>Max Var</th>
                    </>
                  )}
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columnCount}
                  style={{ textAlign: 'center', padding: '32px', color: '#415E7D' }}
                >
                  No roles match your search.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={`${row.jobTitle}||${row.laborType}`}>
                  <td style={{ fontWeight: 600 }}>{row.jobTitle}</td>
                  <td>{row.laborType || '—'}</td>
                  {shownYears.map((year, i) => {
                    const cell = row.byYear.get(year);
                    const prior = i > 0 ? row.byYear.get(shownYears[i - 1]) : undefined;
                    const minVar = change(prior?.min, cell?.min);
                    const maxVar = change(prior?.max, cell?.max);
                    const edge =
                      i === 0 ? undefined : '1px solid var(--outline-variant, #E3E5EC)';
                    return (
                      <React.Fragment key={`${row.jobTitle}-${year}`}>
                        <td style={{ textAlign: 'right', borderLeft: edge }}>
                          {money(cell?.min)}
                        </td>
                        <td style={{ textAlign: 'right' }}>{money(cell?.max)}</td>
                        {i > 0 && (
                          <>
                            <VarianceCell percent={minVar} />
                            <VarianceCell percent={maxVar} />
                          </>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {shownYears.length > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            marginTop: '12px',
            flexWrap: 'wrap',
          }}
        >
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
      )}
    </div>
  );
};

/**
 * One variance figure.
 *
 * An em-dash means the role is missing from one of the two years, or its base
 * rate was zero. `0.00%` would wrongly read as "no change", which is a
 * different and much more reassuring claim than "not comparable".
 */
const VarianceCell: React.FC<{ percent: number | null }> = ({ percent }) => (
  <td
    style={{
      textAlign: 'right',
      fontWeight: 600,
      backgroundColor: varianceBackground(percent),
      color: varianceColor(percent),
    }}
  >
    {percent === null ? '—' : `${percent.toFixed(2)}%`}
  </td>
);
