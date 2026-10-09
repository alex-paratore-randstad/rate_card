import React, { useMemo, useRef, useState } from 'react';
import {
  UploadCloud,
  Tags,
  AlertTriangle,
  Search,
  Trash2,
  Check,
  CircleSlash,
  RotateCcw,
  Wand2,
  ChevronDown,
} from 'lucide-react';
import { useRateCard } from '../../context/RateCardContext';
import { needsReview, readStandardTitleFile } from '../../services/titleMappingService';
import { StandardTitleList, StandardTitleResolution } from '../../types/rateCard';
import { normalizeJobTitle } from '../../services/titleService';
import { toDomoDateTime } from '../../utils/formatters';
import { asPercent } from '../../services/stringSimilarity';

/**
 * The standard title list, and every card title matched onto it.
 *
 * The list is the new standard: each card title is matched to it as soon as
 * both exist, and the match applies at once — reports group by it without
 * waiting for anyone. Review is how a person confirms or corrects a match, and
 * the queue leads with the ones the matcher was least sure of, heaviest first.
 */

type Filter = 'review' | 'auto' | 'reviewed' | 'all';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'review', label: 'Needs review' },
  { id: 'auto', label: 'Auto-matched' },
  { id: 'reviewed', label: 'Reviewed' },
  { id: 'all', label: 'All' },
];

const PAGE = 100;

const CONFIDENCE_PILL: Record<StandardTitleResolution['confidence'], { cls: string; label: string }> = {
  exact: { cls: 'success', label: 'Exact' },
  high: { cls: 'success', label: 'High' },
  medium: { cls: 'warning', label: 'Medium' },
  low: { cls: 'warning', label: 'Low' },
  none: { cls: 'error', label: 'No match' },
};

export const TitleMappingPanel: React.FC = () => {
  const {
    standardTitles,
    loadStandardTitles,
    clearStandardTitles,
    titleResolutions,
    decideTitles,
    undoTitleDecision,
    clearTitleMappings,
    scopedRateCards,
  } = useRateCard();

  const [pending, setPending] = useState<(StandardTitleList & { duplicates: string[] }) | null>(
    null
  );
  const [isHovered, setIsHovered] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('review');
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState(PAGE);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** The review list follows the scope bar; the matching itself does not. */
  const inScope = useMemo(() => {
    const keys = new Set(scopedRateCards.map((r) => normalizeJobTitle(r.jobTitle || '')));
    const counts = new Map<string, number>();
    for (const r of scopedRateCards) {
      const key = normalizeJobTitle(r.jobTitle || '');
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return titleResolutions
      .filter((r) => keys.has(r.uploadedTitleKey))
      .map((r) => ({ ...r, recordCount: counts.get(r.uploadedTitleKey) ?? r.recordCount }))
      .sort((a, b) => b.recordCount - a.recordCount);
  }, [titleResolutions, scopedRateCards]);

  const standardKeys = useMemo(
    () => new Set((standardTitles?.titles ?? []).map(normalizeJobTitle)),
    [standardTitles]
  );
  const sortedStandards = useMemo(
    () => [...(standardTitles?.titles ?? [])].sort((a, b) => a.localeCompare(b)),
    [standardTitles]
  );

  const counts = useMemo(() => {
    const c = { exact: 0, auto: 0, review: 0, reviewed: 0, mappedRecords: 0, records: 0 };
    for (const r of inScope) {
      c.records += r.recordCount;
      if (r.standardTitle) c.mappedRecords += r.recordCount;
      if (r.decision) c.reviewed += 1;
      else if (needsReview(r)) c.review += 1;
      else if (r.confidence === 'exact') c.exact += 1;
      else c.auto += 1;
    }
    return c;
  }, [inScope]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return inScope.filter((r) => {
      if (filter === 'review' && (r.decision || !needsReview(r))) return false;
      if (filter === 'auto' && r.status !== 'auto') return false;
      if (filter === 'reviewed' && !r.decision) return false;
      if (!term) return true;
      return (
        r.uploadedTitle.toLowerCase().includes(term) ||
        (r.standardTitle || '').toLowerCase().includes(term)
      );
    });
  }, [inScope, filter, search]);

  /** Unreviewed matches the matcher is sure of, among those on screen. */
  const confident = visible.filter(
    (r) => r.status === 'auto' && (r.confidence === 'exact' || r.confidence === 'high')
  );

  const processFile = async (file: File) => {
    setIsReading(true);
    setErrorMessage(null);
    try {
      setPending(await readStandardTitleFile(file));
    } catch (err: any) {
      setErrorMessage(`Could not read that file: ${err?.message || 'invalid format'}`);
    } finally {
      setIsReading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const confirmPending = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const { duplicates: _dropped, ...list } = pending;
      if (await loadStandardTitles({ ...list, uploadedAt: toDomoDateTime() })) {
        setPending(null);
        setFilter('review');
      }
    } finally {
      setBusy(false);
    }
  };

  const decide = async (items: { resolution: StandardTitleResolution; standardTitle: string }[]) => {
    setBusy(true);
    try {
      await decideTitles(items);
    } finally {
      setBusy(false);
    }
  };

  const undo = async (resolution: StandardTitleResolution) => {
    setBusy(true);
    try {
      await undoTitleDecision(resolution);
    } finally {
      setBusy(false);
    }
  };

  const dropzone = (
    <div
      className={`dropzone ${isHovered ? 'active' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setIsHovered(true);
      }}
      onDragLeave={() => setIsHovered(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsHovered(false);
        const file = e.dataTransfer.files?.[0];
        if (file) processFile(file);
      }}
      onClick={() => fileInputRef.current?.click()}
    >
      <UploadCloud size={32} color="#255CA9" />
      <div style={{ marginTop: '10px', fontWeight: 600 }}>
        {isReading ? 'Reading…' : 'Drop the standard title list here, or click to choose'}
      </div>
      <div className="text-meta" style={{ marginTop: '4px' }}>
        CSV or Excel, one title per row. A header row is optional.
      </div>
    </div>
  );

  return (
    <>
      <div className="tonal-card">
        <div className="card-header-row">
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Tags size={20} color="#255CA9" />
              <span>Standard Titles</span>
            </h2>
            <span className="app-subtitle">
              {standardTitles
                ? `${standardTitles.titles.length} standard titles from ${standardTitles.sourceFileName}` +
                  (standardTitles.uploadedAt ? ` · loaded ${standardTitles.uploadedAt.slice(0, 10)}` : '')
                : 'Every card title is matched to this list · needs no Domo connection'}
            </span>
          </div>
          {standardTitles && !pending && (
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                className="btn-secondary"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy || isReading}
              >
                <UploadCloud size={15} />
                <span>{isReading ? 'Reading…' : 'Replace list'}</span>
              </button>
              <button
                className="btn-secondary"
                disabled={busy}
                onClick={() => {
                  if (window.confirm('Remove the standard title list? Reviewed decisions are kept.')) {
                    clearStandardTitles();
                  }
                }}
              >
                <Trash2 size={15} />
                <span>Remove</span>
              </button>
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) processFile(file);
          }}
        />

        {errorMessage && (
          <div className="status-pill error" style={{ marginBottom: '14px' }}>
            <AlertTriangle size={14} />
            {errorMessage}
          </div>
        )}

        {pending ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <span style={{ fontWeight: 600 }}>{pending.titles.length} standard titles</span>
              <span className="text-meta"> read from {pending.sourceFileName}</span>
              {pending.duplicates.length > 0 && (
                <div className="text-meta">
                  {pending.duplicates.length} duplicate{pending.duplicates.length === 1 ? '' : 's'}{' '}
                  dropped: {pending.duplicates.slice(0, 5).join(', ')}
                </div>
              )}
            </div>
            <div className="tonal-card-sub text-meta" style={{ lineHeight: 1.6 }}>
              {pending.titles.slice(0, 12).join(' · ')}
              {pending.titles.length > 12 ? ` · … and ${pending.titles.length - 12} more` : ''}
            </div>
            {standardTitles && (
              <div className="text-meta">
                This replaces the current list of {standardTitles.titles.length}. Reviewed decisions
                are kept.
              </div>
            )}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button className="btn-primary" onClick={confirmPending} disabled={busy}>
                {busy ? 'Storing…' : `Use these ${pending.titles.length} titles`}
              </button>
              <button className="btn-secondary" onClick={() => setPending(null)} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          !standardTitles && dropzone
        )}
      </div>

      {standardTitles && inScope.length === 0 && (
        <div className="tonal-card">
          <span className="app-subtitle">
            No rate card titles in the current scope. Ingest a card, or widen the selectors above.
          </span>
        </div>
      )}

      {inScope.length > 0 && (standardTitles || counts.reviewed > 0) && (
        <div className="tonal-card">
          <div className="card-header-row">
            <div>
              <h2 style={{ fontSize: '1.05rem' }}>Title Matching</h2>
              <span className="app-subtitle">
                Card titles in scope, matched to the standard list · most records first
              </span>
            </div>
            {counts.reviewed > 0 && (
              <button
                className="btn-secondary"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      'Discard every reviewed decision? Titles go back to their automatic match.'
                    )
                  ) {
                    clearTitleMappings();
                  }
                }}
              >
                <RotateCcw size={15} />
                <span>Reset reviews</span>
              </button>
            )}
          </div>

          <div className="kpi-grid">
            <div className="kpi-card">
              <span className="kpi-label">Records mapped</span>
              <span className="display-metric">
                {counts.records ? asPercent(counts.mappedRecords / counts.records) : '—'}
              </span>
              <span className="text-meta">
                {counts.mappedRecords} of {counts.records} record(s)
              </span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Exact</span>
              <span className="display-metric">{counts.exact}</span>
              <span className="text-meta">same title once seniority is set aside</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Confident</span>
              <span className="display-metric">{counts.auto}</span>
              <span className="text-meta">close match, applied</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Needs review</span>
              <span
                className="display-metric"
                style={{ color: counts.review ? 'var(--status-warning)' : undefined }}
              >
                {counts.review}
              </span>
              <span className="text-meta">uncertain or no match</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Reviewed</span>
              <span className="display-metric">{counts.reviewed}</span>
              <span className="text-meta">confirmed or corrected</span>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              gap: '10px',
              flexWrap: 'wrap',
              alignItems: 'center',
              margin: '18px 0 12px',
            }}
          >
            {FILTERS.map((f) => (
              <button
                key={f.id}
                className={filter === f.id ? 'btn-primary' : 'btn-secondary'}
                style={{ padding: '6px 14px', fontSize: '0.82rem' }}
                onClick={() => {
                  setFilter(f.id);
                  setShown(PAGE);
                }}
              >
                {f.label}
              </button>
            ))}
            <div style={{ position: 'relative', width: '240px', marginLeft: 'auto' }}>
              <Search
                size={16}
                color="#415E7D"
                style={{ position: 'absolute', left: '12px', top: '12px' }}
              />
              <input
                type="text"
                className="form-control"
                style={{ paddingLeft: '36px' }}
                placeholder="Search titles..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setShown(PAGE);
                }}
              />
            </div>
          </div>

          {confident.length > 0 && (
            <div style={{ marginBottom: '12px' }}>
              <button
                className="btn-teal"
                disabled={busy}
                onClick={() =>
                  decide(
                    confident.map((r) => ({
                      resolution: r,
                      standardTitle: r.proposed!.standardTitle,
                    }))
                  )
                }
              >
                <Wand2 size={16} />
                <span>
                  Confirm {confident.length} exact and high-confidence{' '}
                  {confident.length === 1 ? 'match' : 'matches'}
                </span>
              </button>
            </div>
          )}

          {visible.length === 0 ? (
            <div className="tonal-card-sub text-meta">
              {filter === 'review' ? 'Nothing left to review.' : 'No titles match this view.'}
            </div>
          ) : (
            <div className="table-container">
              <table className="randstad-table">
                <thead>
                  <tr>
                    <th>Card title</th>
                    <th style={{ textAlign: 'right' }}>Records</th>
                    <th>Standard title</th>
                    <th>Match</th>
                    <th style={{ textAlign: 'right' }}>Review</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.slice(0, shown).map((r) => (
                    <ResolutionRow
                      key={r.uploadedTitleKey}
                      resolution={r}
                      standards={sortedStandards}
                      standardKeys={standardKeys}
                      busy={busy}
                      onDecide={(standardTitle) => decide([{ resolution: r, standardTitle }])}
                      onUndo={() => undo(r)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {visible.length > shown && (
            <button
              className="btn-secondary"
              style={{ marginTop: '12px' }}
              onClick={() => setShown((n) => n + PAGE)}
            >
              <ChevronDown size={16} />
              <span>
                Show more ({shown} of {visible.length})
              </span>
            </button>
          )}
        </div>
      )}
    </>
  );
};

/** One card title, its match, and the controls to confirm or change it. */
const ResolutionRow: React.FC<{
  resolution: StandardTitleResolution;
  standards: string[];
  standardKeys: Set<string>;
  busy: boolean;
  onDecide: (standardTitle: string) => void;
  onUndo: () => void;
}> = ({ resolution: r, standards, standardKeys, busy, onDecide, onUndo }) => {
  const pill = CONFIDENCE_PILL[r.confidence];
  const current = r.standardTitle ?? '';
  const suggested = r.candidates.map((c) => c.standardTitle);
  // A reviewed standard the current list no longer carries still shows, so
  // the decision can be seen and redone rather than silently blanked.
  const offList = !!current && !standardKeys.has(normalizeJobTitle(current));

  return (
    <tr>
      <td>
        <div style={{ fontWeight: 600 }}>{r.uploadedTitle}</div>
        {r.level && <div className="text-meta">Level: {r.level}</div>}
      </td>
      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.recordCount}</td>
      <td style={{ minWidth: '260px' }}>
        <select
          className="form-control"
          value={current}
          disabled={busy}
          onChange={(e) => onDecide(e.target.value)}
          style={{ fontWeight: r.decision ? 600 : undefined }}
        >
          {/* Choosing "none" from a matched row goes through the button, so the
              blank option only reads as a decision once it is one. */}
          <option value="" disabled={!!current}>
            {r.decision ? '— None fits —' : '— Choose a standard title —'}
          </option>
          {offList && <option value={current}>{current} (not on the list)</option>}
          {suggested.length > 0 && (
            <optgroup label="Suggested">
              {r.candidates.map((c) => (
                <option key={`s-${c.standardTitle}`} value={c.standardTitle}>
                  {c.standardTitle} · {asPercent(c.score)}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="All standard titles">
            {standards
              .filter((t) => !suggested.includes(t))
              .map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
          </optgroup>
        </select>
        {r.status === 'unmatched' && r.candidates[0] && (
          <div className="text-meta" style={{ marginTop: '4px' }}>
            Best guess: {r.candidates[0].standardTitle} · {asPercent(r.candidates[0].score)}
          </div>
        )}
      </td>
      <td>
        {r.decision ? (
          <span className="status-pill info">
            {r.decision.standardTitle ? 'Reviewed' : 'Reviewed · none fits'}
          </span>
        ) : (
          <span className={`status-pill ${pill.cls}`}>
            {pill.label}
            {r.proposed && r.confidence !== 'exact' ? ` · ${asPercent(r.proposed.score)}` : ''}
          </span>
        )}
      </td>
      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        {r.decision ? (
          <button
            className="btn-secondary"
            style={{ padding: '6px 12px', fontSize: '0.8rem' }}
            disabled={busy}
            onClick={onUndo}
            title="Back to the automatic match"
          >
            <RotateCcw size={14} />
            <span>Undo</span>
          </button>
        ) : (
          <div style={{ display: 'inline-flex', gap: '6px' }}>
            {r.standardTitle && (
              <button
                className="btn-secondary"
                style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                disabled={busy}
                onClick={() => onDecide(r.standardTitle!)}
                title="Confirm this match"
              >
                <Check size={14} />
                <span>Confirm</span>
              </button>
            )}
            <button
              className="btn-secondary"
              style={{ padding: '6px 12px', fontSize: '0.8rem' }}
              disabled={busy}
              onClick={() => onDecide('')}
              title="No standard title fits this card title"
            >
              <CircleSlash size={14} />
              <span>None fits</span>
            </button>
          </div>
        )}
      </td>
    </tr>
  );
};
