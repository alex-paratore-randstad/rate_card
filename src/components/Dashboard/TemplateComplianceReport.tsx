import React, { useMemo, useState } from 'react';
import { Gauge, GitCompareArrows, CircleSlash, AlertTriangle, Info } from 'lucide-react';
import { useRateCard } from '../../context/RateCardContext';
import { buildTemplateComplianceReport } from '../../services/templateComplianceService';
import { formatShortCurrency } from '../../utils/formatters';

const hoursLabel = (hours: number) => Math.round(hours).toLocaleString('en-US');
const pct = (share: number | null) => (share === null ? '—' : `${(share * 100).toFixed(1)}%`);
const money = (amount: number, currency: string) =>
  `${currency ? `${currency} ` : ''}${Math.round(amount).toLocaleString('en-US')}`;

/**
 * Bill rate against the ceiling the VMS enforces.
 *
 * Independent of the rate card: both columns are bill-side and sit on the same
 * row in the same currency, so this works with no title matching and for
 * clients with no card at all. It is also the one check with a second opinion
 * available — the source carries its own verdict, which is compared rather
 * than trusted.
 */
export const TemplateComplianceReport: React.FC = () => {
  const { scopedRateCards, clientAliases, titleAliases, assignmentActuals } = useRateCard();

  const [allClients, setAllClients] = useState(false);

  const report = useMemo(
    () =>
      buildTemplateComplianceReport(
        scopedRateCards,
        assignmentActuals ?? [],
        clientAliases,
        titleAliases,
        { allClients }
      ),
    [scopedRateCards, assignmentActuals, clientAliases, titleAliases, allClients]
  );

  if (assignmentActuals === null) return null;

  const { crossCheck } = report;
  const agreementShare = crossCheck.compared > 0 ? crossCheck.agree / crossCheck.compared : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="tonal-card">
        <div className="card-header-row">
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <Gauge size={20} color="var(--randstad-teal)" />
            <div>
              <h2>VMS Ceiling</h2>
              <span className="app-subtitle">
                Bill rate against <code>max_template_bill_rate_st_hr</code> · rate year{' '}
                {report.rateYear || '—'} ·{' '}
                {report.totals.assignments.toLocaleString('en-US')} assignment(s)
              </span>
            </div>
          </div>
          <label
            className="text-meta"
            style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
          >
            <input
              type="checkbox"
              checked={allClients}
              onChange={(e) => setAllClients(e.target.checked)}
            />
            Every client in the dataset
          </label>
        </div>

        <div className="note">
          <strong>Independent of the rate card.</strong> Both columns are bill-side and sit on the
          same row in the same currency, so this needs no currency conversion and no title
          matching — it works before either is done, and for clients with no card at all. Only the
          money is currency-bound, so it is reported per currency and never summed across them.
        </div>

        <div className="kpi-grid">
          <div className="kpi-card">
            <span className="kpi-label">Hours over the ceiling</span>
            <span
              className="display-metric"
              style={{ color: report.totals.hoursOver > 0 ? 'var(--status-error)' : undefined }}
            >
              {pct(report.totals.overShare)}
            </span>
            <span className="text-meta">
              {hoursLabel(report.totals.hoursOver)} of {hoursLabel(report.totals.hoursOver + report.totals.hoursWithin)} judgeable hrs
            </span>
          </div>
          <div className="kpi-card">
            <span className="kpi-label">No ceiling configured</span>
            <span className="display-metric">{pct(report.totals.noCeilingShare)}</span>
            <span className="text-meta">
              {hoursLabel(report.totals.hoursNoCeiling)} hrs the VMS does not govern
            </span>
          </div>
          <div className="kpi-card">
            <span className="kpi-label">Source agrees</span>
            <span className="display-metric">{pct(agreementShare)}</span>
            <span className="text-meta">
              {crossCheck.compared > 0
                ? `${crossCheck.agree} of ${crossCheck.compared} rows`
                : 'nothing comparable'}
            </span>
          </div>
          <div className="kpi-card">
            <span className="kpi-label">Clients covered</span>
            <span className="display-metric">{report.clients.length}</span>
            <span className="text-meta">
              {report.scopedToCardClients ? 'with a rate card in scope' : 'every client loaded'}
            </span>
          </div>
        </div>

        {report.totals.hoursNoCeiling > 0 && (
          <div className="status-pill info" style={{ width: '100%', padding: '12px 16px' }}>
            <CircleSlash size={16} />
            <span>
              {hoursLabel(report.totals.hoursNoCeiling)} hrs have no template ceiling or no bill
              rate recorded, so nothing here judges them. Those hours are outside the VMS&rsquo;s
              own rate governance entirely — worth knowing separately from whether the rest
              complies.
            </span>
          </div>
        )}
      </div>

      {/* The second opinion. Its value is the disagreement, not the agreement. */}
      <div className="tonal-card">
        <div className="card-header-row">
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <GitCompareArrows size={20} color="var(--randstad-blue-primary)" />
            <div>
              <h2>Cross-check against the source&rsquo;s own verdict</h2>
              <span className="app-subtitle">
                {crossCheck.agree} agree · {crossCheck.disagree} disagree ·{' '}
                {crossCheck.uninterpreted} not interpretable
              </span>
            </div>
          </div>
        </div>

        {crossCheck.disagree > 0 && (
          <div className="status-pill error" style={{ width: '100%', padding: '12px 16px' }}>
            <AlertTriangle size={16} />
            <span>
              {crossCheck.disagree} row(s) where <code>compliance_vs_max_template_bill_rate</code>{' '}
              and a direct comparison of the two columns reach opposite conclusions. One of them
              is wrong, and which matters: either the source flag is stale, or it is measuring
              something other than these two columns.
            </span>
          </div>
        )}

        {crossCheck.sourceValues.length === 0 ? (
          <span className="text-meta" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Info size={14} />
            The source column is empty on every row in scope, so there is nothing to compare
            against.
          </span>
        ) : (
          <>
            <p className="text-meta">
              The column&rsquo;s value domain was not documented, so it is reported rather than
              assumed. Check the reading below is right — if any value is misread, the agreement
              figure above is meaningless.
            </p>
            <div className="table-container">
              <table className="randstad-table">
                <thead>
                  <tr>
                    <th>Value in the source</th>
                    <th>Read as</th>
                    <th style={{ textAlign: 'right' }}>Rows</th>
                  </tr>
                </thead>
                <tbody>
                  {crossCheck.sourceValues.map((v) => {
                    const read =
                      crossCheck.interpretation.find((i) => i.value === v.value)?.readAs ??
                      'unrecognised';
                    return (
                      <tr key={v.value}>
                        <td><code>{v.value}</code></td>
                        <td>
                          <span
                            className={`status-pill ${
                              read === 'over' ? 'error' : read === 'within' ? 'success' : 'warning'
                            }`}
                          >
                            {read === 'over'
                              ? 'over ceiling'
                              : read === 'within'
                              ? 'within ceiling'
                              : 'not recognised'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>{v.count.toLocaleString('en-US')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {report.byCurrency.length > 0 && (
        <div className="tonal-card">
          <div className="card-header-row">
            <div>
              <h2>Cost above the ceiling</h2>
              <span className="app-subtitle">
                Per currency. These are not added together — a total across currencies would mean
                nothing.
              </span>
            </div>
          </div>
          <div className="table-container">
            <table className="randstad-table">
              <thead>
                <tr>
                  <th>Currency</th>
                  <th style={{ textAlign: 'right' }}>Assignments</th>
                  <th style={{ textAlign: 'right' }}>Hours</th>
                  <th style={{ textAlign: 'right' }}>Hours over</th>
                  <th style={{ textAlign: 'right' }}>Cost above ceiling</th>
                  <th style={{ textAlign: 'right' }}>Still open</th>
                </tr>
              </thead>
              <tbody>
                {report.byCurrency.map((c) => (
                  <tr key={c.currency}>
                    <td style={{ fontWeight: 600 }}>{c.currency || 'unknown'}</td>
                    <td style={{ textAlign: 'right' }}>{c.assignments.toLocaleString('en-US')}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {hoursLabel(c.hours)}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {hoursLabel(c.hoursOver)}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        fontWeight: 600,
                        fontVariantNumeric: 'tabular-nums',
                        color: c.excessAmount > 0 ? 'var(--status-error)' : undefined,
                      }}
                    >
                      {c.excessAmount > 0 ? money(c.excessAmount, c.currency) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {c.openExcessAmount > 0 ? money(c.openExcessAmount, c.currency) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {report.worst.length > 0 && (
        <div className="tonal-card">
          <div className="card-header-row">
            <div>
              <h2>Assignments over the ceiling ({report.worst.length})</h2>
              <span className="app-subtitle">Ranked by cost above the ceiling.</span>
            </div>
          </div>
          <div className="table-container">
            <table className="randstad-table">
              <thead>
                <tr>
                  <th>Assignment</th>
                  <th>Title</th>
                  {!report.scopedToCardClients && <th>Client</th>}
                  <th style={{ textAlign: 'right' }}>Bill rate</th>
                  <th style={{ textAlign: 'right' }}>Ceiling</th>
                  <th style={{ textAlign: 'right' }}>Hours</th>
                  <th style={{ textAlign: 'right' }}>Cost above</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {report.worst.map((a) => (
                  <tr key={a.assignmentKey}>
                    <td><code>{a.assignmentKey}</code></td>
                    <td>
                      {a.title}
                      {a.supplier && (
                        <span className="text-meta" style={{ display: 'block' }}>
                          {a.supplier}
                          {a.preferredStatus ? ` · ${a.preferredStatus}` : ''}
                        </span>
                      )}
                    </td>
                    {!report.scopedToCardClients && (
                      <td><span className="text-meta">{a.accountName}</span></td>
                    )}
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {formatShortCurrency(a.billRate, a.currency)}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {formatShortCurrency(a.templateMax, a.currency)}
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
                      {money(a.excessAmount, a.currency)}
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
        </div>
      )}

      {report.clients.length > 1 && (
        <div className="tonal-card">
          <div className="card-header-row">
            <div>
              <h2>By client</h2>
              <span className="app-subtitle">Most cost above the ceiling first.</span>
            </div>
          </div>
          <div className="table-container">
            <table className="randstad-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th style={{ textAlign: 'right' }}>Hours</th>
                  <th style={{ textAlign: 'right' }}>Over ceiling</th>
                  <th style={{ textAlign: 'right' }}>No ceiling</th>
                  <th style={{ textAlign: 'right' }}>Cost above</th>
                </tr>
              </thead>
              <tbody>
                {report.clients.slice(0, 100).map((c) => (
                  <tr key={c.clientCode}>
                    <td style={{ fontWeight: 600 }}>
                      {c.accountName}
                      <span className="text-meta" style={{ display: 'block' }}>
                        <code>{c.clientCode}</code>
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {hoursLabel(c.hours)}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {pct(c.overShare)}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {hoursLabel(c.hoursNoCeiling)}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                        color: c.excessAmount > 0 ? 'var(--status-error)' : undefined,
                      }}
                    >
                      {c.excessAmount > 0 ? money(c.excessAmount, c.currency) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
