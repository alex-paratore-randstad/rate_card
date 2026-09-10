import React, { useMemo, useState } from 'react';
import {
  Tags,
  CheckCircle2,
  HelpCircle,
  SearchX,
  Wand2,
  RotateCcw,
  Ban,
  DatabaseZap,
  AlertTriangle,
  ChevronDown,
} from 'lucide-react';
import { useRateCard } from '../../context/RateCardContext';
import {
  buildTitleCandidates,
  resolveTitles,
  autoResolvableTitles,
  AUTO_RESOLVE_SCORE,
} from '../../services/titleMatchService';
import { clientCodeFor } from '../../services/clientMatchService';
import { countryKey } from '../../services/countryService';
import { TitleResolution, TitleResolutionState } from '../../types/rateCard';
import { formatShortCurrency } from '../../utils/formatters';

const STATE_PILL: Record<TitleResolutionState, { className: string; label: string }> = {
  resolved: { className: 'success', label: 'Matched' },
  suggested: { className: 'warning', label: 'Needs review' },
  ambiguous: { className: 'error', label: 'Too close to call' },
  unmatched: { className: 'info', label: 'No candidate found' },
  pending: { className: 'info', label: 'No actuals loaded' },
};

const pct = (score: number) => `${Math.round(score * 100)}%`;
const hrs = (hours: number) => `${Math.round(hours).toLocaleString('en-US')} hrs`;

/** How many queue rows to render at once. The list can run to hundreds. */
const PAGE = 25;

/**
 * Pair the card's job titles with the titles the actuals use.
 *
 * The same problem as client matching at a scale that changes the design.
 * Nobody works through several hundred titles in order, so the queue is ranked
 * by the hours each row would bring into coverage, and the unambiguous matches
 * clear in one action. The first screenful is the part that matters.
 */
export const TitleMatchPanel: React.FC = () => {
  const {
    scopedRateCards,
    clientAliases,
    titleAliases,
    assignmentActuals,
    actualsLoading,
    loadAssignmentActuals,
    resolveTitleMatches,
    unresolveTitle,
  } = useRateCard();

  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(PAGE);

  /** Latest rate year in scope, matching how the coverage report defaults. */
  const rateYear = useMemo(() => {
    const years = Array.from(new Set(scopedRateCards.map((c) => c.rateYear).filter(Boolean))).sort();
    return years[years.length - 1] ?? '';
  }, [scopedRateCards]);

  const candidates = useMemo(() => {
    if (!assignmentActuals) return [];
    const clientCodes = new Set<string>();
    const countries = new Set<string>();
    for (const card of scopedRateCards) {
      const code = clientCodeFor(card.client || '', clientAliases);
      if (code) clientCodes.add(code);
      countries.add(countryKey(card.country || ''));
    }
    return buildTitleCandidates(assignmentActuals, { clientCodes, countries, rateYear });
  }, [assignmentActuals, scopedRateCards, clientAliases, rateYear]);

  const resolutions = useMemo(
    () => resolveTitles(scopedRateCards, candidates, clientAliases, titleAliases, rateYear),
    [scopedRateCards, candidates, clientAliases, titleAliases, rateYear]
  );

  const counts = useMemo(() => {
    const tally: Record<TitleResolutionState, number> = {
      resolved: 0, suggested: 0, ambiguous: 0, unmatched: 0, pending: 0,
    };
    for (const r of resolutions) tally[r.state] += 1;
    return tally;
  }, [resolutions]);

  const auto = useMemo(() => autoResolvableTitles(resolutions), [resolutions]);
  const outstanding = resolutions.filter((r) => r.state !== 'resolved');
  const resolved = resolutions.filter((r) => r.state === 'resolved');
  const hoursAtStake = outstanding.reduce((sum, r) => sum + r.hoursAtStake, 0);

  const accept = async (
    decisions: Parameters<typeof resolveTitleMatches>[0]
  ) => {
    setBusy(true);
    try {
      await resolveTitleMatches(decisions);
    } finally {
      setBusy(false);
    }
  };

  if (!scopedRateCards.length) {
    return (
      <div className="tonal-card">
        <h2>Title Matching</h2>
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
            <h2>Title Matching</h2>
            <span className="app-subtitle">
              {assignmentActuals
                ? `Rate year ${rateYear || '—'} · ${candidates.length} candidate title(s) in the actuals`
                : 'Load the actuals to score the card titles against them.'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            {auto.length > 0 && (
              <button
                className="btn-teal"
                disabled={busy}
                onClick={() =>
                  accept(
                    auto.map(({ resolution, suggestion }) => ({
                      clientCode: resolution.clientCode,
                      cardTitle: resolution.cardTitle,
                      actualTitle: suggestion.candidate.title,
                      actualTitleKey: suggestion.candidate.titleKey,
                      method: 'exact' as const,
                      score: suggestion.score,
                    }))
                  )
                }
              >
                <Wand2 size={16} />
                <span>Accept {auto.length} exact {auto.length === 1 ? 'match' : 'matches'}</span>
              </button>
            )}
            <button
              className="btn-secondary"
              onClick={loadAssignmentActuals}
              disabled={actualsLoading}
            >
              <DatabaseZap size={16} />
              <span>
                {actualsLoading ? 'Loading…' : assignmentActuals ? 'Reload actuals' : 'Load actuals'}
              </span>
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <span className="status-pill success">
            <CheckCircle2 size={14} />
            <span>{counts.resolved} matched</span>
          </span>
          <span className="status-pill warning">
            <HelpCircle size={14} />
            <span>{counts.suggested + counts.ambiguous} awaiting review</span>
          </span>
          <span className="status-pill info">
            <SearchX size={14} />
            <span>{counts.unmatched + counts.pending} without a candidate</span>
          </span>
          {hoursAtStake > 0 && (
            <span className="status-pill info" style={{ marginLeft: 'auto' }}>
              <span>{hrs(hoursAtStake)} would come into coverage</span>
            </span>
          )}
        </div>

        {assignmentActuals && (
          <div className="note">
            <strong>Ranked by hours, not alphabetically.</strong> A title with twenty thousand
            hours behind it is worth reviewing before one with forty, whatever its name. Scoring
            uses spelling, whether the two titles share an occupational group, and whether the
            candidate&rsquo;s actual pay lands in the card band — but only a match at{' '}
            {pct(AUTO_RESOLVE_SCORE)} or above with no close runner-up is accepted automatically.
          </div>
        )}
      </div>

      {outstanding.length > 0 && (
        <div className="tonal-card">
          <div className="card-header-row">
            <div>
              <h2>Awaiting review ({outstanding.length})</h2>
              <span className="app-subtitle">Most hours at stake first.</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {outstanding.slice(0, shown).map((resolution) => (
              <TitleCard
                key={`${resolution.clientCode}-${resolution.cardTitleKey}`}
                resolution={resolution}
                busy={busy}
                onPick={(actualTitle, actualTitleKey, score) =>
                  accept([
                    {
                      clientCode: resolution.clientCode,
                      cardTitle: resolution.cardTitle,
                      actualTitle,
                      actualTitleKey,
                      method: 'confirmed',
                      score,
                    },
                  ])
                }
                onNoMatch={() =>
                  accept([
                    {
                      clientCode: resolution.clientCode,
                      cardTitle: resolution.cardTitle,
                      actualTitle: '',
                      actualTitleKey: '',
                      method: 'none',
                      score: 0,
                    },
                  ])
                }
              />
            ))}
          </div>

          {outstanding.length > shown && (
            <button
              className="btn-secondary"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => setShown((n) => n + PAGE)}
            >
              <ChevronDown size={16} />
              <span>
                Show {Math.min(PAGE, outstanding.length - shown)} more of{' '}
                {outstanding.length - shown} remaining
              </span>
            </button>
          )}
        </div>
      )}

      {resolved.length > 0 && (
        <div className="tonal-card">
          <div className="card-header-row">
            <div>
              <h2>Matched ({resolved.length})</h2>
              <span className="app-subtitle">
                The coverage report joins on these instead of the raw spelling.
              </span>
            </div>
          </div>
          <div className="table-container">
            <table className="randstad-table">
              <thead>
                <tr>
                  <th>Card title</th>
                  <th>Actuals title</th>
                  <th>Basis</th>
                  <th style={{ textAlign: 'right' }}>Hours</th>
                  <th style={{ textAlign: 'right' }}>Change</th>
                </tr>
              </thead>
              <tbody>
                {resolved.slice(0, 200).map((r) => (
                  <tr key={`${r.clientCode}-${r.cardTitleKey}`}>
                    <td style={{ fontWeight: 600 }}>{r.cardTitle}</td>
                    <td>
                      {r.alias?.method === 'none' ? (
                        <span className="text-meta">Declared to have no counterpart</span>
                      ) : (
                        r.alias?.actualTitle
                      )}
                    </td>
                    <td>
                      <span className="text-meta">
                        {r.alias?.method === 'exact'
                          ? 'Exact'
                          : r.alias?.method === 'confirmed'
                          ? `Confirmed · ${pct(r.alias.score)}`
                          : r.alias?.method === 'manual'
                          ? 'Manual'
                          : 'No counterpart'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {r.hoursAtStake ? hrs(r.hoursAtStake) : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="btn-secondary"
                        style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                        disabled={busy}
                        onClick={() => unresolveTitle(r.clientCode, r.cardTitle)}
                      >
                        <RotateCcw size={14} />
                        <span>Redo</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {resolved.length > 200 && (
              <span className="text-meta" style={{ display: 'block', marginTop: '10px' }}>
                Showing 200 of {resolved.length}.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/** One card title and its ranked candidates. */
const TitleCard: React.FC<{
  resolution: TitleResolution;
  busy: boolean;
  onPick: (actualTitle: string, actualTitleKey: string, score: number) => void;
  onNoMatch: () => void;
}> = ({ resolution, busy, onPick, onNoMatch }) => {
  const pill = STATE_PILL[resolution.state];

  return (
    <div className="tonal-card-sub">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
          marginBottom: resolution.suggestions.length ? '12px' : 0,
        }}
      >
        <Tags size={18} color="var(--randstad-blue-primary)" />
        <span style={{ fontWeight: 600, fontSize: '1.05rem' }}>{resolution.cardTitle}</span>
        <span className="text-meta">
          card band {formatShortCurrency(resolution.cardMinRate)} –{' '}
          {formatShortCurrency(resolution.cardMaxRate)}
        </span>
        <span className={`status-pill ${pill.className}`}>{pill.label}</span>
        {resolution.hoursAtStake > 0 && (
          <span className="text-meta">{hrs(resolution.hoursAtStake)} at stake</span>
        )}

        <button
          className="btn-secondary"
          style={{ marginLeft: 'auto', padding: '6px 12px', fontSize: '0.8rem' }}
          disabled={busy}
          onClick={onNoMatch}
        >
          <Ban size={14} />
          <span>No match</span>
        </button>
      </div>

      {resolution.state === 'ambiguous' && (
        <span className="status-pill error" style={{ marginBottom: '10px' }}>
          <AlertTriangle size={14} />
          These candidates score within a few points of each other. Use the hours and the pay
          range to decide.
        </span>
      )}

      {resolution.state === 'pending' && (
        <span className="text-meta">Load the actuals above to score this title.</span>
      )}

      {resolution.state === 'unmatched' && (
        <span className="text-meta">
          No candidate title scored high enough to propose. Either this role is not running under
          any recognisable title, or it genuinely has no actuals — the coverage report will show
          it as a card row with no hours either way.
        </span>
      )}

      {resolution.suggestions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {resolution.suggestions.map((s) => (
            <div
              key={s.candidate.titleKey}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                flexWrap: 'wrap',
                padding: '10px 14px',
                background: 'var(--surface-container-lowest)',
                border: '1px solid var(--ghost-border)',
                borderLeft: `3px solid ${
                  s.bandOverlaps === false ? 'var(--status-warning)' : 'var(--ghost-border)'
                }`,
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <span
                className="display-metric"
                style={{ fontSize: '1rem', minWidth: '48px', color: 'var(--randstad-blue-primary)' }}
              >
                {pct(s.score)}
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: '220px' }}>
                <span style={{ fontWeight: 600 }}>{s.candidate.title}</span>
                <span className="text-meta">
                  {hrs(s.candidate.hours)} · {s.candidate.assignments} assignment
                  {s.candidate.assignments === 1 ? '' : 's'}
                  {s.candidate.weightedPayRate !== undefined && (
                    <>
                      {' · '}
                      {formatShortCurrency(
                        s.candidate.weightedPayRate,
                        s.candidate.currencies[0] || 'USD'
                      )}{' '}
                      weighted
                    </>
                  )}
                </span>
                {s.candidate.socBroadGroup && (
                  <span className="text-meta">{s.candidate.socBroadGroup}</span>
                )}
              </div>
              <span className="text-meta" style={{ flex: 1, minWidth: '200px' }}>
                {s.reason}
              </span>
              <button
                className="btn-primary"
                style={{ padding: '8px 16px', fontSize: '0.85rem' }}
                disabled={busy}
                onClick={() => onPick(s.candidate.title, s.candidate.titleKey, s.score)}
              >
                <CheckCircle2 size={14} />
                <span>Use this</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
