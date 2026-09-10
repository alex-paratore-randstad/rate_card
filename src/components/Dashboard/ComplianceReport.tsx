import React, { useMemo, useState } from 'react';
import {
  Scale,
  TrendingUp,
  TrendingDown,
  Shuffle,
  DatabaseZap,
  CalendarRange,
  AlertTriangle,
  Info,
} from 'lucide-react';
import { useRateCard } from '../../context/RateCardContext';
import {
  buildComplianceReport,
  ComplianceTitleRow,
} from '../../services/complianceService';
import { describeScope } from '../../services/coverageService';
import { formatShortCurrency } from '../../utils/formatters';

const hoursLabel = (hours: number) => Math.round(hours).toLocaleString('en-US');
const pct = (share: number | null) => (share === null ? '—' : `${(share * 100).toFixed(1)}%`);

const money = (amount: number, currency: string | null) =>
  `${currency ? `${currency} ` : ''}${Math.round(amount).toLocaleString('en-US')}`;

/**
 * How a title's hours sit against its band, as a shape rather than three
 * numbers. Dispersion is the thing this report exists to show, and a bar shows
 * it at a glance where a column of percentages does not.
 */
const BandBar: React.FC<{ row: ComplianceTitleRow }> = ({ row }) => {
  const total = row.hours || 1;
  const seg = (h: number, color: string, label: string) =>
    h > 0 ? (
      <div
        style={{ width: `${(h / total) * 100}%`, background: color, height: '100%' }}
        title={`${label}: ${hoursLabel(h)} hrs`}
      />
    ) : null;

  return (
    <div
      style={{
        display: 'flex',
        height: '10px',
        width: '120px',
        borderRadius: '2px',
        overflow: 'hidden',
        background: 'var(--surface-container-low)',
      }}
    >
      {seg(row.hoursBelow, 'var(--randstad-blue-secondary)', 'Below min')}
      {seg(row.hoursIn, 'var(--status-success)', 'In band')}
      {seg(row.hoursAbove, 'var(--status-error)', 'Above max')}
    </div>
  );
};

/**
 * Whether the work is paid inside the band it was priced at.
 *
 * Every assignment is classified on its own and the hours summed by class. A
 * title's average rate is never compared to its band — a title averaging
 * comfortably inside 60-90 can have a third of its hours above 90, and
 * averaging first reports that as compliant.
 */
export const ComplianceReport: React.FC = () => {
  const {
    scopedRateCards,
    clientAliases,
    titleAliases,
    assignmentActuals,
    actualsLoading,
    loadAssignmentActuals,
  } = useRateCard();

  const [year, setYear] = useState<string | undefined>(undefined);
  const [openOnly, setOpenOnly] = useState(false);

  const report = useMemo(
    () =>
      buildComplianceReport(
        scopedRateCards,
        assignmentActuals ?? [],
        clientAliases,
        titleAliases,
        year
      ),
    [scopedRateCards, assignmentActuals, clientAliases, titleAliases, year]
  );

  const worst = openOnly
    ? report.worstAssignments.filter((a) => a.isOpen)
    : report.worstAssignments;

  if (!scopedRateCards.length) {
    return (
      <div className="tonal-card">
        <h2>Card Compliance</h2>
        <span className="app-subtitle">
          No rate card records in the current scope. Ingest a file, or widen the selectors above.
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="tonal-card">
        <div className="card-header-row">
          <div>
            <h2>Card Compliance</h2>
            <span className="app-subtitle">
              Rate year {report.rateYear || '—'} · {describeScope(report.countries)} ·{' '}
              {report.totals.assignments.toLocaleString('en-US')} assignment(s) judged against a band
            </span>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            {report.availableYears.length > 1 && (
              <>
                <CalendarRange size={18} color="var(--randstad-blue-primary)" />
                <select
                  className="form-control"
                  style={{ width: '120px' }}
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
                {actualsLoading ? 'Loading…' : assignmentActuals ? 'Reload actuals' : 'Load actuals'}
              </span>
            </button>
          </div>
        </div>

        {assignmentActuals === null ? (
          <div className="skip">
            <strong>No actuals loaded.</strong>
            <span>Load the assignment dataset to compare it against the card.</span>
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
                <span className="kpi-label">Hours inside band</span>
                <span className="display-metric">{pct(report.totals.inBandShare)}</span>
                <span className="text-meta">
                  {hoursLabel(report.totals.hoursIn)} of {hoursLabel(report.totals.hours)} hrs
                </span>
              </div>
              <div className="kpi-card">
                <span className="kpi-label">Above max</span>
                <span className="display-metric" style={{ color: 'var(--status-error)' }}>
                  {money(report.totals.excessAmount, report.currency)}
                </span>
                <span className="text-meta">
                  {hoursLabel(report.totals.hoursAbove)} hrs · {money(report.totals.openExcessAmount, report.currency)} still open
                </span>
              </div>
              <div className="kpi-card">
                <span className="kpi-label">Below min</span>
                <span className="display-metric">
                  {money(report.totals.shortfallAmount, report.currency)}
                </span>
                <span className="text-meta">{hoursLabel(report.totals.hoursBelow)} hrs</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-label">Scattered titles</span>
                <span className="display-metric">{report.totals.titlesScattered}</span>
                <span className="text-meta">an average alone would call these compliant</span>
              </div>
            </div>

            <div className="note">
              <strong>Every assignment is judged on its own.</strong> Hours are then summed by
              verdict, rather than a title&rsquo;s average rate being compared to its band —
              averaging first lets a high assignment and a low one cancel out and reports the
              title as compliant. The <em>scattered</em> count is how often that would have
              happened here.
            </div>

            {report.unbandedHours > 0 && (
              <div className="status-pill warning" style={{ width: '100%', padding: '12px 16px' }}>
                <Info size={16} />
                <span>
                  {hoursLabel(report.unbandedHours)} hrs across {report.unbandedTitles} title(s)
                  are in scope but have no card band, so nothing here judges them. They are a
                  coverage gap, not a compliance failure — see the Card Coverage tab.
                </span>
              </div>
            )}

            {report.unresolvedClients.length > 0 && (
              <div className="status-pill warning" style={{ width: '100%', padding: '12px 16px' }}>
                <AlertTriangle size={16} />
                <span>
                  Excluded entirely, having no confirmed client match:{' '}
                  {report.unresolvedClients.join(', ')}.
                </span>
              </div>
            )}

            {report.excluded.length > 0 && (
              <details>
                <summary className="text-meta" style={{ cursor: 'pointer' }}>
                  Why other assignment rows were set aside
                </summary>
                <div className="table-container" style={{ marginTop: '10px' }}>
                  <table className="randstad-table">
                    <thead>
                      <tr><th>Reason</th><th style={{ textAlign: 'right' }}>Rows</th></tr>
                    </thead>
                    <tbody>
                      {report.excluded.map((e) => (
                        <tr key={e.reason}>
                          <td>{e.reason}</td>
                          <td style={{ textAlign: 'right' }}>{e.count.toLocaleString('en-US')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </>
        )}
      </div>

      {assignmentActuals !== null && report.titles.length > 0 && (
        <div className="tonal-card">
          <div className="card-header-row">
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
              <Scale size={20} color="var(--randstad-blue-primary)" />
              <div>
                <h2>By title ({report.titles.length})</h2>
                <span className="app-subtitle">
                  Most money above band first. The bar shows how the hours actually sit.
                </span>
              </div>
            </div>
          </div>

          <div className="table-container">
            <table className="randstad-table">
              <thead>
                <tr>
                  <th>Card title</th>
                  <th>Band</th>
                  <th>Hours by verdict</th>
                  <th style={{ textAlign: 'right' }}>Observed range</th>
                  <th style={{ textAlign: 'right' }}>Weighted</th>
                  <th style={{ textAlign: 'right' }}>Above band</th>
                </tr>
              </thead>
              <tbody>
                {report.titles.slice(0, 200).map((t) => (
                  <tr key={`${t.clientCode}-${t.cardTitle}-${t.actualTitle}`}>
                    <td style={{ fontWeight: 600 }}>
                      {t.cardTitle}
                      {t.actualTitle.toLowerCase() !== t.cardTitle.toLowerCase() && (
                        <span className="text-meta" style={{ display: 'block' }}>
                          matched to &ldquo;{t.actualTitle}&rdquo;
                        </span>
                      )}
                      {t.scattered && (
                        <span
                          className="status-pill warning"
                          style={{ marginTop: '4px', fontSize: '0.7rem' }}
                        >
                          <Shuffle size={11} />
                          scattered
                        </span>
                      )}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {formatShortCurrency(t.cardMinRate, t.currency)} –{' '}
                      {formatShortCurrency(t.cardMaxRate, t.currency)}
                      {t.cardRowCount > 1 && (
                        <span className="text-meta" style={{ display: 'block' }}>
                          widest of {t.cardRowCount} rows
                        </span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <BandBar row={t} />
                        <span className="text-meta" style={{ whiteSpace: 'nowrap' }}>
                          {hoursLabel(t.hours)} hrs · {t.assignments} asg
                        </span>
                      </div>
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        whiteSpace: 'nowrap',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {formatShortCurrency(t.observedMin, t.currency)} –{' '}
                      {formatShortCurrency(t.observedMax, t.currency)}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {formatShortCurrency(t.weightedRate, t.currency)}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                        color: t.excessAmount > 0 ? 'var(--status-error)' : undefined,
                        fontWeight: t.excessAmount > 0 ? 600 : undefined,
                      }}
                    >
                      {t.excessAmount > 0 ? money(t.excessAmount, t.currency) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {report.titles.length > 200 && (
              <span className="text-meta" style={{ display: 'block', marginTop: '10px' }}>
                Showing 200 of {report.titles.length}.
              </span>
            )}
          </div>
        </div>
      )}

      {assignmentActuals !== null && report.worstAssignments.length > 0 && (
        <div className="tonal-card">
          <div className="card-header-row">
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
              <TrendingUp size={20} color="var(--status-error)" />
              <div>
                <h2>Assignments above band ({worst.length})</h2>
                <span className="app-subtitle">
                  Ranked by money. Worker identity is deliberately absent from this dataset — the
                  assignment key is what looks the record up in the VMS.
                </span>
              </div>
            </div>
            <label
              className="text-meta"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                checked={openOnly}
                onChange={(e) => setOpenOnly(e.target.checked)}
              />
              Open assignments only
            </label>
          </div>

          {worst.length === 0 ? (
            <span className="text-meta">No open assignments are above band.</span>
          ) : (
            <div className="table-container">
              <table className="randstad-table">
                <thead>
                  <tr>
                    <th>Assignment</th>
                    <th>Title</th>
                    <th style={{ textAlign: 'right' }}>Rate</th>
                    <th style={{ textAlign: 'right' }}>Over max by</th>
                    <th style={{ textAlign: 'right' }}>Hours</th>
                    <th style={{ textAlign: 'right' }}>Cost above band</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {worst.map((a) => (
                    <tr key={a.assignmentKey}>
                      <td><code>{a.assignmentKey}</code></td>
                      <td>
                        {a.actualTitle}
                        {a.supplier && (
                          <span className="text-meta" style={{ display: 'block' }}>
                            {a.supplier}
                            {a.stateProvince ? ` · ${a.stateProvince}` : ''}
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {formatShortCurrency(a.rate, a.currency)}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {formatShortCurrency(a.rate - a.cardMaxRate, a.currency)}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {hoursLabel(a.hours)}
                      </td>
                      <td
                        style={{
                          textAlign: 'right',
                          fontWeight: 600,
                          color: 'var(--status-error)',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {money(a.varianceAmount, a.currency)}
                      </td>
                      <td>
                        <span className={`status-pill ${a.isOpen ? 'warning' : 'info'}`}>
                          {a.isOpen ? 'Open' : 'Closed'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {assignmentActuals !== null && report.totals.hoursBelow > 0 && (
        <div className="tonal-card">
          <div className="card-header-row">
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
              <TrendingDown size={20} color="var(--randstad-blue-secondary)" />
              <div>
                <h2>Below the band</h2>
                <span className="app-subtitle">
                  {hoursLabel(report.totals.hoursBelow)} hrs paid under the minimum, worth{' '}
                  {money(report.totals.shortfallAmount, report.currency)} against it.
                </span>
              </div>
            </div>
          </div>
          <div className="note">
            Reads differently from the other direction. Under-paying against a band can mean a
            retention or quality risk, or a card set too high for the market — and unlike money
            above the band, it is not a saving anyone can book.
          </div>
        </div>
      )}
    </div>
  );
};
