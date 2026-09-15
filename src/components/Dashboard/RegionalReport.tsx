import React, { useMemo, useState } from 'react';
import {
  Map as MapIcon,
  Ruler,
  DatabaseZap,
  CalendarRange,
  AlertTriangle,
  Info,
} from 'lucide-react';
import { useRateCard } from '../../context/RateCardContext';
import {
  buildRegionalReport,
  suggestedBand,
  GeographyLevel,
  GEOGRAPHY_LABELS,
  MATERIAL_SPREAD,
  MIN_ASSIGNMENTS,
  MIN_HOURS,
  TitleRegionRow,
} from '../../services/regionalService';
import { describeScope } from '../../services/coverageService';
import { formatShortCurrency } from '../../utils/formatters';

const hoursLabel = (hours: number) => Math.round(hours).toLocaleString('en-US');

/** A differential as the uplift it represents: 1.12 reads as +12.0%. */
const uplift = (differential: number) => {
  const p = (differential - 1) * 100;
  return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`;
};

const upliftColour = (differential: number) =>
  Math.abs(differential - 1) < 0.03
    ? 'var(--on-surface-muted)'
    : differential > 1
    ? 'var(--status-error)'
    : 'var(--randstad-blue-secondary)';

/**
 * Whether a national band describes the market.
 *
 * Every differential is computed within a title and then weighted, never from
 * raw regional averages — otherwise the report measures which roles a region
 * staffs rather than what that region pays.
 */
export const RegionalReport: React.FC = () => {
  const {
    scopedRateCards,
    clientAliases,
    titleAliases,
    assignmentActuals,
    actualsLoading,
    loadAssignmentActuals,
  } = useRateCard();

  const [level, setLevel] = useState<GeographyLevel>('state_province');
  const [year, setYear] = useState<string | undefined>(undefined);

  const report = useMemo(
    () =>
      buildRegionalReport(scopedRateCards, assignmentActuals ?? [], clientAliases, titleAliases, {
        level,
        rateYear: year,
      }),
    [scopedRateCards, assignmentActuals, clientAliases, titleAliases, level, year]
  );

  if (!scopedRateCards.length) {
    return (
      <div className="tonal-card">
        <h2>Regional Differentials</h2>
        <span className="app-subtitle">
          No rate card records in the current scope. Ingest a file, or widen the selectors above.
        </span>
      </div>
    );
  }

  const reliableRegions = report.regionIndex.filter((r) => r.reliable);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="tonal-card">
        <div className="card-header-row">
          <div>
            <h2>Regional Differentials</h2>
            <span className="app-subtitle">
              Does a national band describe this market? · rate year {report.rateYear || '—'} ·{' '}
              {describeScope(report.countries)}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <Ruler size={18} color="var(--randstad-blue-primary)" />
            <select
              className="form-control"
              style={{ width: '170px' }}
              value={level}
              onChange={(e) => setLevel(e.target.value as GeographyLevel)}
            >
              {(Object.keys(GEOGRAPHY_LABELS) as GeographyLevel[]).map((l) => (
                <option key={l} value={l}>{GEOGRAPHY_LABELS[l]}</option>
              ))}
            </select>
            {report.availableYears.length > 1 && (
              <>
                <CalendarRange size={18} color="var(--randstad-blue-primary)" />
                <select
                  className="form-control"
                  style={{ width: '110px' }}
                  value={report.rateYear}
                  onChange={(e) => setYear(e.target.value)}
                >
                  {report.availableYears.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </>
            )}
            <button className="btn-teal" onClick={loadAssignmentActuals} disabled={actualsLoading}>
              <DatabaseZap size={16} />
              <span>
                {actualsLoading ? 'Loading…' : assignmentActuals ? 'Reload' : 'Load actuals'}
              </span>
            </button>
          </div>
        </div>

        {assignmentActuals === null ? (
          <div className="skip">
            <strong>No actuals loaded.</strong>
            <span>Load the assignment dataset to measure the regional spread.</span>
          </div>
        ) : (
          <>
            {report.currencyWarning && (
              <div className="status-pill error" style={{ width: '100%', padding: '12px 16px' }}>
                <AlertTriangle size={16} />
                <span>{report.currencyWarning}</span>
              </div>
            )}

            <div className="kpi-grid">
              <div className="kpi-card">
                <span className="kpi-label">Titles where tiers would matter</span>
                <span className="display-metric">
                  {report.totals.titlesWithMaterialSpread}
                  <span style={{ fontSize: '0.55em', color: 'var(--on-surface-subtle)' }}>
                    {' '}/ {report.totals.titlesAnalysed}
                  </span>
                </span>
                <span className="text-meta">
                  regional spread over {(MATERIAL_SPREAD * 100).toFixed(0)}%
                </span>
              </div>
              <div className="kpi-card">
                <span className="kpi-label">Regions measured</span>
                <span className="display-metric">{report.totals.regionsMeasured}</span>
                <span className="text-meta">with enough volume across 2+ titles</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-label">Hours analysed</span>
                <span className="display-metric">{hoursLabel(report.totals.hoursAnalysed)}</span>
                <span className="text-meta">on titles the card prices</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-label">Set aside as too thin</span>
                <span className="display-metric">{report.totals.thinCells}</span>
                <span className="text-meta">
                  {hoursLabel(report.totals.thinHours)} hrs under the volume bar
                </span>
              </div>
            </div>

            <div className="note">
              <strong>Every differential is measured within a title, against the median
              region.</strong> Comparing the average rate paid in a region against the average
              paid nationally would measure which roles that region staffs, not what it pays — a
              region weighted toward senior work looks expensive wherever it is. The baseline is
              the median of the regions with enough volume rather than the hours-weighted
              average, so the region holding most of the hours cannot quietly define the line it
              is judged against.
            </div>

            <div className="note">
              <strong>A region needs {MIN_ASSIGNMENTS} assignments and {MIN_HOURS} hours</strong>{' '}
              before its differential counts. One assignment is a single negotiation, not a market
              rate. Thin cells are still shown, marked, and kept out of every index and suggested
              band.
            </div>
          </>
        )}
      </div>

      {assignmentActuals !== null && reliableRegions.length > 0 && (
        <div className="tonal-card">
          <div className="card-header-row">
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
              <MapIcon size={20} color="var(--randstad-blue-primary)" />
              <div>
                <h2>What a regional tier would apply</h2>
                <span className="app-subtitle">
                  Multiply the national band by this to price the region. Measured, not assumed.
                </span>
              </div>
            </div>
          </div>
          <div className="table-container">
            <table className="randstad-table">
              <thead>
                <tr>
                  <th>{GEOGRAPHY_LABELS[report.level]}</th>
                  <th style={{ textAlign: 'right' }}>Against national</th>
                  <th style={{ textAlign: 'right' }}>Titles</th>
                  <th style={{ textAlign: 'right' }}>Assignments</th>
                  <th style={{ textAlign: 'right' }}>Hours</th>
                </tr>
              </thead>
              <tbody>
                {reliableRegions.map((r) => (
                  <tr key={r.region}>
                    <td style={{ fontWeight: 600 }}>{r.region}</td>
                    <td
                      style={{
                        textAlign: 'right',
                        fontWeight: 600,
                        fontVariantNumeric: 'tabular-nums',
                        color: upliftColour(r.index),
                      }}
                    >
                      {uplift(r.index)}
                      <span className="text-meta" style={{ marginLeft: '6px' }}>
                        (x{r.index.toFixed(3)})
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>{r.titles}</td>
                    <td style={{ textAlign: 'right' }}>{r.assignments}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {hoursLabel(r.hours)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {report.regionIndex.length > reliableRegions.length && (
            <span className="text-meta" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Info size={14} />
              {report.regionIndex.length - reliableRegions.length} further region(s) had volume on
              only one title, so their differential is that title&rsquo;s story rather than the
              region&rsquo;s. They are left out of this table.
            </span>
          )}
        </div>
      )}

      {assignmentActuals !== null &&
        report.titles.map((title) => (
          <TitleRegions key={`${title.clientCode}-${title.cardTitle}`} title={title} level={report.level} />
        ))}

      {assignmentActuals !== null && report.titles.length === 0 && (
        <div className="tonal-card">
          <span className="text-meta" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Info size={14} />
            No matched titles with hours in scope yet. Regional analysis is per title, so it
            follows the Title Matching queue — resolve a few and this fills in.
          </span>
        </div>
      )}
    </div>
  );
};

/** One title's rates across geography, with the band a tier would carry. */
const TitleRegions: React.FC<{ title: TitleRegionRow; level: GeographyLevel }> = ({
  title,
  level,
}) => (
  <div className="tonal-card">
    <div className="card-header-row">
      <div>
        <h2>{title.cardTitle}</h2>
        <span className="app-subtitle">
          National band {formatShortCurrency(title.cardMinRate, title.currency)} –{' '}
          {formatShortCurrency(title.cardMaxRate, title.currency)} · paid{' '}
          {formatShortCurrency(title.overallRate, title.currency)} weighted across{' '}
          {hoursLabel(title.hours)} hrs · measured against{' '}
          {formatShortCurrency(title.referenceRate, title.currency)}, the median region
        </span>
      </div>
      {title.spread !== null && (
        <span className={`status-pill ${title.tiersWouldMatter ? 'warning' : 'success'}`}>
          {title.tiersWouldMatter
            ? `${((title.spread - 1) * 100).toFixed(0)}% spread — tiers would matter`
            : `${((title.spread - 1) * 100).toFixed(0)}% spread — one band covers it`}
        </span>
      )}
    </div>

    <div className="table-container">
      <table className="randstad-table">
        <thead>
          <tr>
            <th>{GEOGRAPHY_LABELS[level]}</th>
            <th style={{ textAlign: 'right' }}>Weighted rate</th>
            <th style={{ textAlign: 'right' }}>Against this title</th>
            <th style={{ textAlign: 'right' }}>Assignments</th>
            <th style={{ textAlign: 'right' }}>Hours</th>
            <th style={{ textAlign: 'right' }}>Band a tier would carry</th>
          </tr>
        </thead>
        <tbody>
          {title.cells.map((cell) => {
            const band = suggestedBand(title, cell.differential);
            return (
              <tr key={cell.region} style={{ opacity: cell.reliable ? 1 : 0.55 }}>
                <td style={{ fontWeight: cell.reliable ? 600 : 400 }}>
                  {cell.region}
                  {!cell.reliable && (
                    <span className="text-meta" style={{ display: 'block' }}>
                      too thin to measure
                    </span>
                  )}
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {formatShortCurrency(cell.weightedRate, title.currency)}
                </td>
                <td
                  style={{
                    textAlign: 'right',
                    fontWeight: cell.reliable ? 600 : 400,
                    fontVariantNumeric: 'tabular-nums',
                    color: cell.reliable ? upliftColour(cell.differential) : undefined,
                  }}
                >
                  {uplift(cell.differential)}
                </td>
                <td style={{ textAlign: 'right' }}>{cell.assignments}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {hoursLabel(cell.hours)}
                </td>
                <td
                  style={{
                    textAlign: 'right',
                    whiteSpace: 'nowrap',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {cell.reliable ? (
                    <>
                      {formatShortCurrency(band.min, title.currency)} –{' '}
                      {formatShortCurrency(band.max, title.currency)}
                    </>
                  ) : (
                    <span className="text-meta">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  </div>
);
