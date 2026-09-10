import React, { useMemo, useState } from 'react';
import {
  Link2,
  Upload,
  CheckCircle2,
  HelpCircle,
  SearchX,
  Wand2,
  RotateCcw,
  Ban,
  DatabaseZap,
} from 'lucide-react';
import { useRateCard } from '../../context/RateCardContext';
import {
  autoResolvable,
  parseClientDirectory,
  AUTO_RESOLVE_SCORE,
} from '../../services/clientMatchService';
import { ClientResolution, ClientResolutionState } from '../../types/rateCard';
import { formatDateRandstad } from '../../utils/formatters';
import { describeCountry } from '../../services/countryService';

const STATE_PILL: Record<ClientResolutionState, { className: string; label: string }> = {
  resolved: { className: 'success', label: 'Matched' },
  suggested: { className: 'warning', label: 'Needs review' },
  ambiguous: { className: 'error', label: 'Too close to call' },
  unmatched: { className: 'info', label: 'No candidate found' },
  pending: { className: 'info', label: 'No directory loaded' },
};

const METHOD_LABEL: Record<string, string> = {
  exact: 'Exact',
  confirmed: 'Confirmed',
  manual: 'Manual',
  none: 'No Domo counterpart',
};

const pct = (score: number) => `${Math.round(score * 100)}%`;

const hoursLabel = (hours?: number) =>
  hours ? `${Math.round(hours).toLocaleString('en-US')} hrs` : 'no hours on record';

/**
 * The countries a candidate operates in, as recognition context. Long lists are
 * truncated — the point is confirming the right account, not enumerating it.
 */
const countriesLabel = (countries: string[]): string => {
  if (!countries.length) return '';
  const named = countries.map(describeCountry);
  if (named.length <= 3) return named.join(' · ');
  return `${named.slice(0, 3).join(' · ')} +${named.length - 3} more`;
};

/**
 * Resolve each uploaded client string onto the client code Domo uses.
 *
 * The screen exists because the two names never match exactly — the card says
 * "Xerox" and Domo says "Xerox Corporation". Scoring proposes; a person
 * decides. The only case that resolves without asking is an exact-strength
 * match standing clearly apart from the runner-up, because a wrong client
 * match silently blends two markets into one meaningless average.
 */
export const ClientMatchPanel: React.FC = () => {
  const {
    clientDirectory,
    clientResolutions,
    loadClientDirectory,
    loadClientDirectoryFromDomo,
    resolveClient,
    unresolveClient,
    domoAccess,
  } = useRateCard();

  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const counts = useMemo(() => {
    const tally: Record<ClientResolutionState, number> = {
      resolved: 0, suggested: 0, ambiguous: 0, unmatched: 0, pending: 0,
    };
    for (const r of clientResolutions) tally[r.state] += 1;
    return tally;
  }, [clientResolutions]);

  const auto = useMemo(() => autoResolvable(clientResolutions), [clientResolutions]);
  const outstanding = clientResolutions.filter((r) => r.state !== 'resolved');
  const resolved = clientResolutions.filter((r) => r.state === 'resolved');

  const handleLoadPaste = async () => {
    const { entries, errors } = parseClientDirectory(pasteText);
    setParseErrors(errors);
    if (!entries.length) return;

    setBusy(true);
    try {
      await loadClientDirectory(entries, 'pasted');
      setPasteText('');
      setPasteOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const handleAutoResolve = async () => {
    setBusy(true);
    try {
      // Sequential: each write reads back the alias collection to avoid
      // creating a second decision for the same client.
      for (const { uploadedClient, suggestion } of auto) {
        await resolveClient(
          uploadedClient,
          { clientCode: suggestion.entry.clientCode, accountName: suggestion.entry.accountName },
          'exact',
          suggestion.score
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="tonal-card">
        <div className="card-header-row">
          <div>
            <h2>Client Matching</h2>
            <span className="app-subtitle">
              {clientDirectory
                ? `${clientDirectory.entries.length} candidate clients, ${
                    clientDirectory.source === 'pasted' ? 'pasted' : 'from dataset'
                  } ${formatDateRandstad(clientDirectory.loadedAt)}`
                : 'No candidate list loaded yet — nothing can be matched until one is.'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            {auto.length > 0 && (
              <button className="btn-teal" onClick={handleAutoResolve} disabled={busy}>
                <Wand2 size={16} />
                <span>Accept {auto.length} exact {auto.length === 1 ? 'match' : 'matches'}</span>
              </button>
            )}
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await loadClientDirectoryFromDomo();
                } finally {
                  setBusy(false);
                }
              }}
              title={
                domoAccess === 'none'
                  ? 'Outside Domo the dataset is unreachable unless rows have been seeded locally'
                  : 'Read rate_card_client_directory from Domo'
              }
            >
              <DatabaseZap size={16} />
              <span>Load from Domo</span>
            </button>
            <button className="btn-secondary" onClick={() => setPasteOpen((v) => !v)}>
              <Upload size={16} />
              <span>{clientDirectory ? 'Replace by paste' : 'Paste candidate list'}</span>
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '4px' }}>
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
        </div>

        {pasteOpen && (
          <div className="tonal-card-sub" style={{ marginTop: '16px' }}>
            <label className="form-label">
              Paste the <code>rate_card_client_directory</code> output
            </label>
            <span className="text-meta" style={{ display: 'block', marginBottom: '8px' }}>
              Tab or comma separated, header row optional, in the order:
              client code, account name, country, hours, latest month. Only the first
              two are required.
            </span>
            <textarea
              className="form-control"
              style={{ width: '100%', minHeight: '160px', fontFamily: 'monospace', resize: 'vertical' }}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={'rsr_client_code\taccount_name\tcountry\thours\tlatest_month\nC001\tXerox Corporation\tUSA\t120000\t2026-07-01'}
            />
            {parseErrors.length > 0 && (
              <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {parseErrors.slice(0, 8).map((err, i) => (
                  <span key={i} className="status-pill warning" style={{ alignSelf: 'flex-start' }}>
                    {err}
                  </span>
                ))}
                {parseErrors.length > 8 && (
                  <span className="text-meta">and {parseErrors.length - 8} more.</span>
                )}
              </div>
            )}
            <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
              <button className="btn-primary" onClick={handleLoadPaste} disabled={busy || !pasteText.trim()}>
                <Upload size={16} />
                <span>Load candidates</span>
              </button>
              <button className="btn-secondary" onClick={() => { setPasteOpen(false); setParseErrors([]); }}>
                <span>Cancel</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {clientResolutions.length === 0 && (
        <div className="tonal-card">
          <span className="app-subtitle">
            No client values on the current rate card records. Tag an upload with a client and
            it will appear here.
          </span>
        </div>
      )}

      {outstanding.length > 0 && (
        <div className="tonal-card">
          <div className="card-header-row">
            <div>
              <h2>Awaiting review ({outstanding.length})</h2>
              <span className="app-subtitle">
                Highest record counts first. A match at {pct(AUTO_RESOLVE_SCORE)} or above with no
                close runner-up is accepted automatically; everything else is a judgement call.
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {outstanding.map((resolution) => (
              <ResolutionCard
                key={resolution.uploadedClient}
                resolution={resolution}
                busy={busy}
                onPick={async (entry, score) => {
                  setBusy(true);
                  try {
                    await resolveClient(resolution.uploadedClient, entry, 'confirmed', score);
                  } finally {
                    setBusy(false);
                  }
                }}
                onNoMatch={async () => {
                  setBusy(true);
                  try {
                    await resolveClient(resolution.uploadedClient, null, 'none', 0);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            ))}
          </div>
        </div>
      )}

      {resolved.length > 0 && (
        <div className="tonal-card">
          <div className="card-header-row">
            <div>
              <h2>Matched ({resolved.length})</h2>
              <span className="app-subtitle">
                Reports join on the client code, never on the name.
              </span>
            </div>
          </div>

          <div className="table-container">
            <table className="randstad-table">
              <thead>
                <tr>
                  <th>Uploaded as</th>
                  <th>Domo account</th>
                  <th>Client code</th>
                  <th>Basis</th>
                  <th style={{ textAlign: 'right' }}>Records</th>
                  <th style={{ textAlign: 'right' }}>Decided</th>
                  <th style={{ textAlign: 'right' }}>Change</th>
                </tr>
              </thead>
              <tbody>
                {resolved.map((r) => (
                  <tr key={r.uploadedClient}>
                    <td style={{ fontWeight: 600 }}>{r.uploadedClient}</td>
                    <td>
                      {r.alias?.method === 'none' ? (
                        <span className="text-meta">Declared to have no counterpart</span>
                      ) : (
                        r.alias?.accountName
                      )}
                    </td>
                    <td><code>{r.alias?.clientCode || '—'}</code></td>
                    <td>
                      <span className="text-meta">
                        {METHOD_LABEL[r.alias?.method || ''] || r.alias?.method}
                        {r.alias?.method !== 'none' && r.alias?.score
                          ? ` · ${pct(r.alias.score)}`
                          : ''}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>{r.recordCount}</td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="text-meta">
                        {r.alias?.confirmedAt ? formatDateRandstad(r.alias.confirmedAt) : '—'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="btn-secondary"
                        style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                        disabled={busy}
                        onClick={() => unresolveClient(r.uploadedClient)}
                      >
                        <RotateCcw size={14} />
                        <span>Redo</span>
                      </button>
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

/** One unresolved client and its ranked candidates. */
const ResolutionCard: React.FC<{
  resolution: ClientResolution;
  busy: boolean;
  onPick: (entry: { clientCode: string; accountName: string }, score: number) => void;
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
        <Link2 size={18} color="var(--randstad-blue-primary)" />
        <span style={{ fontWeight: 600, fontSize: '1.05rem' }}>{resolution.uploadedClient}</span>
        <span className="text-meta">
          {resolution.recordCount} {resolution.recordCount === 1 ? 'record' : 'records'}
        </span>
        <span className={`status-pill ${pill.className}`}>{pill.label}</span>

        <button
          className="btn-secondary"
          style={{ marginLeft: 'auto', padding: '6px 12px', fontSize: '0.8rem' }}
          disabled={busy}
          onClick={onNoMatch}
        >
          <Ban size={14} />
          <span>No match in Domo</span>
        </button>
      </div>

      {resolution.state === 'ambiguous' && (
        <span className="status-pill error" style={{ marginBottom: '10px' }}>
          These candidates score within a few points of each other. Picking one on the score alone
          would be a guess — use the hours and country to decide.
        </span>
      )}

      {resolution.state === 'pending' && (
        <span className="text-meta">Load a candidate list above to score this client.</span>
      )}

      {resolution.state === 'unmatched' && (
        <span className="text-meta">
          Nothing in the candidate list scored high enough to propose. Either the account is
          absent from the directory, or it is named differently enough that it needs picking by
          hand — refresh the directory, or record that there is no counterpart.
        </span>
      )}

      {resolution.suggestions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {resolution.suggestions.map((s) => (
            <div
              key={s.entry.clientCode}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                flexWrap: 'wrap',
                padding: '10px 14px',
                background: 'var(--surface-container-lowest)',
                border: '1px solid var(--ghost-border)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <span
                className="display-metric"
                style={{ fontSize: '1rem', minWidth: '48px', color: 'var(--randstad-blue-primary)' }}
              >
                {pct(s.score)}
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: '240px' }}>
                <span style={{ fontWeight: 600 }}>{s.entry.accountName}</span>
                <span className="text-meta">
                  <code>{s.entry.clientCode}</code> · {hoursLabel(s.entry.hours)}
                </span>
                {(s.entry.countries ?? []).length > 0 && (
                  <span className="text-meta">{countriesLabel(s.entry.countries ?? [])}</span>
                )}
              </div>
              <span className="text-meta" style={{ flex: 1, minWidth: '200px' }}>
                {s.reason}
              </span>
              <button
                className="btn-primary"
                style={{ padding: '8px 16px', fontSize: '0.85rem' }}
                disabled={busy}
                onClick={() =>
                  onPick(
                    { clientCode: s.entry.clientCode, accountName: s.entry.accountName },
                    s.score
                  )
                }
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
