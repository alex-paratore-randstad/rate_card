import React, { useMemo, useState } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  FileQuestion,
  DatabaseZap,
  CalendarRange,
  AlertTriangle,
  Info,
} from 'lucide-react';
import { useRateCard } from '../../context/RateCardContext';
import { buildCoverageReport, describeScope, CoverageRow } from '../../services/coverageService';
import { formatShortCurrency } from '../../utils/formatters';

const hoursLabel = (hours?: number) =>
  hours === undefined ? '—' : `${Math.round(hours).toLocaleString('en-US')}`;

const pct = (share: number | null) => (share === null ? '—' : `${(share * 100).toFixed(1)}%`);

const band = (row: CoverageRow) =>
  row.cardMinRate === undefined || row.cardMaxRate === undefined
    ? '—'
    : `${formatShortCurrency(row.cardMinRate)} – ${formatShortCurrency(row.cardMaxRate)}`;

/**
 * Which work the rate card actually governs.
 *
 * Built before any variance report on purpose: it exercises the client,
 * country and title joins and nothing else, so there is evidence those hold
 * before a compliance percentage depends on them. A variance figure computed
 * across a broken join looks completely reasonable.
 */
export const CoverageReport: React.FC = () => {
  const {
    scopedRateCards,
    clientAliases,
    assignmentActuals,
    actualsLoading,
    loadAssignmentActuals,
  } = useRateCard();

  const [year, setYear] = useState<string | undefined>(undefined);

  const report = useMemo(
    () => buildCoverageReport(scopedRateCards, assignmentActuals ?? [], clientAliases, year),
    [scopedRateCards, assignmentActuals, clientAliases, year]
  );

  const uncovered = report.rows.filter((r) => r.state === 'actuals-only');
  const matched = report.rows.filter((r) => r.state === 'matched');
  const cardOnly = report.rows.filter((r) => r.state === 'card-only');

  if (!scopedRateCards.length) {
    return (
      <div className="tonal-card">
        <h2>Card Coverage</h2>
        <span className="app-subtitle">
          No rate card records in the current scope. Ingest a file, or widen the client and
          country selectors above.
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="tonal-card">
        <div className="card-header-row">
          <div>
            <h2>Card Coverage</h2>
            <span className="app-subtitle">
              Rate year {report.rateYear || '—'} · {describeScope(report.countries)} ·{' '}
              {report.actualsConsidered.toLocaleString('en-US')} assignment row(s) in scope
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
                {actualsLoading
                  ? 'Loading actuals…'
                  : assignmentActuals
                  ? 'Reload actuals'
                  : 'Load actuals'}
              </span>
            </button>
          </div>
        </div>

        {assignmentActuals === null ? (
          <div className="skip">
            <strong>No actuals loaded.</strong>
            <span>
              The assignment dataset is the one large read in this app, so it is fetched on
              demand rather than when the app opens. Load it to compare against the card.
            </span>
          </div>
        ) : (
          <>
            <div className="kpi-grid">
              <div className="kpi-card">
                <span className="kpi-label">Hours a card governs</span>
                <span className="display-metric">{pct(report.totals.coveredShare)}</span>
                <span className="text-meta">
                  {hoursLabel(report.totals.coveredHours)} of{' '}
                  {hoursLabel(report.totals.coveredHours + report.totals.uncoveredHours)} hrs
                </span>
              </div>
              <div className="kpi-card">
                <span className="kpi-label">Titles with no card row</span>
                <span className="display-metric">{report.totals.titlesWithoutCard}</span>
                <span className="text-meta">{hoursLabel(report.totals.uncoveredHours)} hrs unpriced</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-label">Card rows with no hours</span>
                <span className="display-metric">{report.totals.cardRowsWithout}</span>
                <span className="text-meta">no work, or the title did not match</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-label">Matched titles</span>
                <span className="display-metric">{report.totals.cardRowsWithActuals}</span>
                <span className="text-meta">card and actuals agree</span>
              </div>
            </div>

            {/* The caveat that decides how every number above should be read. */}
            <div className="status-pill warning" style={{ width: '100%', padding: '12px 16px' }}>
              <AlertTriangle size={16} />
              <span>
                Titles join on exact spelling only — abbreviations and levels are normalised, but
                nothing more. Until the title matcher exists, a row under &ldquo;no card row&rdquo;
                may be a title that failed to match rather than work nobody priced. Treat the
                unmatched lists as a queue to review, not as a finding.
              </span>
            </div>

            {report.currencyWarning && (
              <div className="status-pill error" style={{ width: '100%', padding: '12px 16px' }}>
                <AlertTriangle size={16} />
                <span>{report.currencyWarning}</span>
              </div>
            )}

            {report.unresolvedClients.length > 0 && (
              <div className="status-pill warning" style={{ width: '100%', padding: '12px 16px' }}>
                <ShieldAlert size={16} />
                <span>
                  {report.unresolvedClients.length} client(s) in scope have no confirmed match and
                  are excluded entirely: {report.unresolvedClients.join(', ')}. Resolve them on the
                  Client Matching tab.
                </span>
              </div>
            )}

            {report.actualsExcluded.length > 0 && (
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
                      {report.actualsExcluded.map((e) => (
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

      {assignmentActuals !== null && (
        <>
          <CoverageTable
            title="Hours with no card row"
            subtitle="Largest first. Either work nobody priced, or a title that needs matching."
            icon={<ShieldAlert size={20} color="var(--status-error)" />}
            rows={uncovered}
            emptyMessage="Every title with hours has a card row."
            showBand={false}
          />

          <CoverageTable
            title="Card rows with no hours"
            subtitle="Bands priced for work that is not running under that exact title."
            icon={<FileQuestion size={20} color="var(--status-warning)" />}
            rows={cardOnly}
            emptyMessage="Every card row has hours behind it."
            showActuals={false}
          />

          <CoverageTable
            title="Matched"
            subtitle="Card and actuals agree on client, country, year and title."
            icon={<ShieldCheck size={20} color="var(--status-success)" />}
            rows={matched}
            emptyMessage="Nothing matched — start with the two lists above."
          />
        </>
      )}
    </div>
  );
};

const CoverageTable: React.FC<{
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  rows: CoverageRow[];
  emptyMessage: string;
  showBand?: boolean;
  showActuals?: boolean;
}> = ({ title, subtitle, icon, rows, emptyMessage, showBand = true, showActuals = true }) => (
  <div className="tonal-card">
    <div className="card-header-row">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
        {icon}
        <div>
          <h2>
            {title} ({rows.length})
          </h2>
          <span className="app-subtitle">{subtitle}</span>
        </div>
      </div>
    </div>

    {rows.length === 0 ? (
      <span className="text-meta" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Info size={14} />
        {emptyMessage}
      </span>
    ) : (
      <div className="table-container">
        <table className="randstad-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Client</th>
              {showBand && <th>Card band</th>}
              {showActuals && <th style={{ textAlign: 'right' }}>Assignments</th>}
              {showActuals && <th style={{ textAlign: 'right' }}>Hours</th>}
              {showActuals && <th style={{ textAlign: 'right' }}>Weighted pay</th>}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 200).map((row) => (
              <tr key={`${row.clientCode}-${row.titleKey}`}>
                <td style={{ fontWeight: 600 }}>
                  {row.title}
                  {row.cardRowCount && row.cardRowCount > 1 && (
                    <span className="text-meta" style={{ marginLeft: '8px' }}>
                      widest of {row.cardRowCount} card rows
                    </span>
                  )}
                </td>
                <td><span className="text-meta">{row.clientLabel}</span></td>
                {showBand && <td>{band(row)}</td>}
                {showActuals && (
                  <td style={{ textAlign: 'right' }}>{row.assignments ?? '—'}</td>
                )}
                {showActuals && (
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {hoursLabel(row.hours)}
                  </td>
                )}
                {showActuals && (
                  <td style={{ textAlign: 'right' }}>
                    {row.weightedPayRate === undefined
                      ? '—'
                      : formatShortCurrency(row.weightedPayRate, row.currencies?.[0] || 'USD')}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 200 && (
          <span className="text-meta" style={{ display: 'block', marginTop: '10px' }}>
            Showing the 200 largest of {rows.length} rows.
          </span>
        )}
      </div>
    )}
  </div>
);
