import React, { useMemo } from 'react';
import { ShieldCheck, FileWarning, CheckCircle2 } from 'lucide-react';
import { useRateCard } from '../../context/RateCardContext';
import { auditCardBands } from '../../services/cardQualityService';

/**
 * The card checked against itself, with no Domo data involved.
 *
 * `auditCardBands` already ran in two places: once inside the ingest modal,
 * where it scrolls past at the moment attention is on confirming columns, and
 * once buried at the head of the compliance report, where it only appears if
 * the actuals have loaded. Both are the wrong time. The findings describe the
 * *card*, they do not expire, and they change how every other number should be
 * read — the check that found a card whose maximum was every title's minimum
 * times 11/9 belongs somewhere it can be returned to without re-uploading a
 * file or connecting to anything.
 */

const SEVERITY_LABEL: Record<'high' | 'medium', string> = {
  high: 'Read before quoting any figure',
  medium: 'Worth confirming',
};

export const CardQualityReport: React.FC = () => {
  const { scopedRateCards, filters } = useRateCard();

  /** Audited a year at a time, so each year's card reports its own problems. */
  const byYear = useMemo(() => {
    const years = Array.from(new Set(scopedRateCards.map((r) => r.rateYear))).sort().reverse();
    return years.map((year) => {
      const records = scopedRateCards.filter((r) => r.rateYear === year);
      return { year, records, issues: auditCardBands(records) };
    });
  }, [scopedRateCards]);

  const scopeNote =
    filters.client === 'ALL' && filters.country === 'ALL'
      ? 'every ingested card'
      : [filters.client, filters.country].filter((v) => v !== 'ALL').join(' · ');

  const totalIssues = byYear.reduce((n, y) => n + y.issues.length, 0);

  if (!scopedRateCards.length) {
    return (
      <div className="tonal-card">
        <div className="card-header-row">
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldCheck size={20} color="#255CA9" />
              <span>Card Quality</span>
            </h2>
            <span className="app-subtitle">
              Structural checks on the uploaded bands, before anything is built on them
            </span>
          </div>
        </div>
        <div className="tonal-card-sub">
          <span className="text-meta">
            No rate card data in scope — ingest a report, or widen the client and country filter.
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
            <ShieldCheck size={20} color="#255CA9" />
            <span>Card Quality</span>
          </h2>
          <span className="app-subtitle">
            {scopedRateCards.length} record{scopedRateCards.length === 1 ? '' : 's'} across{' '}
            {byYear.length} rate year{byYear.length === 1 ? '' : 's'} · {scopeNote} · needs no Domo
            connection
          </span>
        </div>
        <span className={`status-pill ${totalIssues ? 'warning' : 'success'}`}>
          {totalIssues
            ? `${totalIssues} issue${totalIssues === 1 ? '' : 's'} found`
            : 'No structural issues'}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {byYear.map(({ year, records, issues }) => (
          <div key={year}>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: '10px',
                marginBottom: '10px',
              }}
            >
              <h3 style={{ margin: 0, fontSize: '1rem' }}>{year}</h3>
              <span className="text-meta">
                {records.length} band{records.length === 1 ? '' : 's'} checked
              </span>
            </div>

            {issues.length === 0 ? (
              <div className="tonal-card-sub">
                <span className="text-meta" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <CheckCircle2 size={14} color="#257F56" />
                  Every band has a usable minimum below its maximum, and the band widths vary title
                  by title the way a market range does.
                </span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {issues.map((issue) => (
                  <div
                    key={issue.kind}
                    className="tonal-card-sub"
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                      borderLeft: `3px solid ${
                        issue.severity === 'high' ? 'var(--status-error)' : 'var(--status-warning)'
                      }`,
                    }}
                  >
                    <span
                      className={`status-pill ${issue.severity === 'high' ? 'error' : 'warning'}`}
                      style={{ alignSelf: 'flex-start' }}
                    >
                      <FileWarning size={12} />
                      {SEVERITY_LABEL[issue.severity]}
                    </span>
                    <span style={{ fontWeight: 600 }}>{issue.summary}</span>
                    <span className="text-meta">{issue.consequence}</span>
                    <span className="text-meta">
                      <strong>What to do:</strong> {issue.action}
                    </span>
                    <span className="text-meta">
                      Affects {issue.count} of {issue.outOf}: {issue.titles.join(', ')}
                      {issue.count > issue.titles.length
                        ? ` and ${issue.count - issue.titles.length} more`
                        : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
