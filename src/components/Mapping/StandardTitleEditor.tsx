import React, { useMemo, useState } from 'react';
import { Plus, Search, Pencil, Trash2, Check, X } from 'lucide-react';
import { useRateCard } from '../../context/RateCardContext';
import { createTitleMatcher, standardTitleUsage } from '../../services/titleMappingService';
import { normalizeJobTitle } from '../../services/titleService';

/**
 * The standard title list, maintained in place.
 *
 * Every change is saved as it is made — there is no draft to lose and no
 * "save list" step to forget. Each row says how many card titles currently
 * resolve to it, so a rename or a removal can be weighed before it is made.
 */
export const StandardTitleEditor: React.FC = () => {
  const { standardTitles, editStandardTitles, titleResolutions } = useRateCard();

  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<{ from: string; to: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const titles = standardTitles?.titles ?? [];
  const usage = useMemo(() => standardTitleUsage(titleResolutions), [titleResolutions]);
  const matcher = useMemo(() => createTitleMatcher(titles), [titles]);

  /** Titles typed into the add box: one per line or comma. */
  const drafted = draft
    .split(/[\n,]/)
    .map((t) => t.trim())
    .filter(Boolean);

  /**
   * A warning while typing a single title: either it is already there, or
   * something very like it is, which is how a list grows two names for one
   * role. Advisory only — "Data Analyst" and "Data Analytics Manager" are
   * close and both legitimate.
   */
  const hint = useMemo(() => {
    if (drafted.length !== 1) return null;
    const key = normalizeJobTitle(drafted[0]);
    const existing = titles.find((t) => normalizeJobTitle(t) === key);
    if (existing) return { blocking: true, text: `Already on the list as "${existing}".` };
    const { candidates, level } = matcher(drafted[0]);
    // Seniority is taken off card titles before matching, so a standard
    // title carrying it can never be the exact match for anything.
    if (level.length) {
      const base = candidates[0]?.score === 1 ? candidates[0].standardTitle : null;
      return {
        blocking: false,
        text: base
          ? `Seniority (${level.join(' ')}) is set aside when matching, so those card titles already ` +
            `match "${base}" — this title would never be chosen.`
          : `Seniority (${level.join(' ')}) is set aside when matching, so this title would never ` +
            'be an exact match. Consider adding it without the level.',
      };
    }
    const near = candidates.filter((c) => c.score >= 0.75).slice(0, 3);
    if (near.length) {
      return {
        blocking: false,
        text: `Similar titles already on the list: ${near.map((c) => c.standardTitle).join(', ')}.`,
      };
    }
    return null;
  }, [draft, titles, matcher]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? titles.filter((t) => t.toLowerCase().includes(term)) : titles;
  }, [titles, search]);

  const add = async () => {
    if (!drafted.length) return;
    setBusy(true);
    setNotice(null);
    try {
      const skipped = await editStandardTitles({ kind: 'add', titles: drafted });
      if (skipped === null) return;
      const added = drafted.length - skipped.length;
      setDraft('');
      setNotice({
        ok: added > 0,
        text:
          (added > 0 ? `Added ${added} title${added === 1 ? '' : 's'}.` : 'Nothing was added.') +
          (skipped.length
            ? ` Skipped: ${skipped.map((s) => `${s.title} (${s.reason})`).join('; ')}.`
            : ''),
      });
    } finally {
      setBusy(false);
    }
  };

  const saveRename = async () => {
    if (!editing) return;
    if (editing.to.trim() === editing.from) {
      setEditing(null);
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      if ((await editStandardTitles({ kind: 'rename', ...editing })) !== null) {
        setNotice({ ok: true, text: `Renamed "${editing.from}" to "${editing.to.trim()}".` });
        setEditing(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async (title: string) => {
    const u = usage.get(normalizeJobTitle(title));
    const message = u
      ? `Remove "${title}"? ${u.cardTitles} card title${u.cardTitles === 1 ? '' : 's'} ` +
        `(${u.records} records) currently match it. Any reviews pointing at it are cleared, ` +
        'and those card titles are matched again against the rest of the list.'
      : `Remove "${title}"? No current card title matches it.`;
    if (!window.confirm(message)) return;
    setBusy(true);
    setNotice(null);
    try {
      if ((await editStandardTitles({ kind: 'remove', title })) !== null) {
        setNotice({ ok: true, text: `Removed "${title}".` });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tonal-card">
      <div className="card-header-row">
        <div>
          <h2 style={{ fontSize: '1.05rem' }}>Edit the list</h2>
          <span className="app-subtitle">
            Changes save as you make them, and every card title is matched again straight away
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
        <textarea
          className="form-control"
          rows={drafted.length > 1 || draft.includes('\n') ? 4 : 1}
          style={{ flex: 1, resize: 'vertical', fontFamily: 'inherit' }}
          placeholder="Add a title — or paste several, one per line or separated by commas"
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !draft.includes('\n')) {
              e.preventDefault();
              if (!hint?.blocking) add();
            }
          }}
        />
        <button
          className="btn-primary"
          onClick={add}
          disabled={busy || drafted.length === 0 || !!hint?.blocking}
          style={{ whiteSpace: 'nowrap' }}
        >
          <Plus size={16} />
          <span>
            {busy ? 'Saving…' : drafted.length > 1 ? `Add ${drafted.length} titles` : 'Add title'}
          </span>
        </button>
      </div>
      {hint && (
        <div
          className="text-meta"
          style={{
            marginTop: '6px',
            textTransform: 'none',
            color: hint.blocking ? 'var(--status-error, #B3261E)' : undefined,
          }}
        >
          {hint.text}
        </div>
      )}
      {notice && (
        <div
          className={`status-pill ${notice.ok ? 'success' : 'warning'}`}
          style={{ marginTop: '10px' }}
        >
          {notice.text}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          margin: '18px 0 10px',
          gap: '10px',
        }}
      >
        <span className="text-meta">
          {search.trim() ? `${visible.length} of ${titles.length}` : `${titles.length}`} standard
          titles
        </span>
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
            placeholder="Find a title..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="table-container" style={{ maxHeight: '480px', overflowY: 'auto' }}>
        <table className="randstad-table">
          <thead>
            <tr>
              <th>Standard title</th>
              <th style={{ textAlign: 'right' }}>Card titles</th>
              <th style={{ textAlign: 'right' }}>Records</th>
              <th style={{ textAlign: 'right' }}>Edit</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', padding: '24px', color: '#415E7D' }}>
                  No title matches that search.
                </td>
              </tr>
            )}
            {visible.map((title) => {
              const u = usage.get(normalizeJobTitle(title));
              const isEditing = editing?.from === title;
              return (
                <tr key={title}>
                  <td style={{ fontWeight: 600 }}>
                    {isEditing ? (
                      <input
                        className="form-control"
                        autoFocus
                        value={editing.to}
                        disabled={busy}
                        onChange={(e) => setEditing({ from: title, to: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveRename();
                          if (e.key === 'Escape') setEditing(null);
                        }}
                      />
                    ) : (
                      title
                    )}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {u?.cardTitles ?? '—'}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {u?.records ?? '—'}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {isEditing ? (
                      <div style={{ display: 'inline-flex', gap: '6px' }}>
                        <button
                          className="btn-primary"
                          style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                          disabled={busy || !editing.to.trim()}
                          onClick={saveRename}
                        >
                          <Check size={14} />
                          <span>Save</span>
                        </button>
                        <button
                          className="btn-secondary"
                          style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                          disabled={busy}
                          onClick={() => setEditing(null)}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'inline-flex', gap: '6px' }}>
                        <button
                          className="btn-secondary"
                          style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                          disabled={busy}
                          onClick={() => setEditing({ from: title, to: title })}
                          title="Rename this title"
                        >
                          <Pencil size={14} />
                          <span>Rename</span>
                        </button>
                        <button
                          className="btn-secondary"
                          style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                          disabled={busy}
                          onClick={() => remove(title)}
                          title="Remove this title from the list"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
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
};
