import React, { useState } from 'react';
import { CheckCircle2, Layers, AlertTriangle, Copy } from 'lucide-react';
import { SheetSummary, SheetTags } from '../../services/parserService';

interface Props {
  fileName: string;
  sheets: SheetSummary[];
  onCancel: () => void;
  onConfirm: (selected: SheetSummary[], tags: Record<string, SheetTags>) => void;
}

/**
 * A workbook often holds several tabs and only some are rate data. Reading just
 * the first one dropped the rest silently, so the choice is shown explicitly:
 * tabs that parse are pre-selected, and the ones that do not say why.
 */
export const SheetPicker: React.FC<Props> = ({ fileName, sheets, onCancel, onConfirm }) => {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(sheets.filter((s) => s.isRateData).map((s) => s.name))
  );

  /**
   * Client and country per tab. A workbook that splits by market needs these to
   * differ — tagging the whole upload once would average the markets together.
   * Prefilled from the tab's own columns when it has them.
   */
  const [tags, setTags] = useState<Record<string, SheetTags>>(() =>
    Object.fromEntries(
      sheets.map((s) => [
        s.name,
        { client: s.detectedClient ?? '', country: s.detectedCountry ?? '' },
      ])
    )
  );

  const setTag = (name: string, field: keyof SheetTags, value: string) =>
    setTags((prev) => ({ ...prev, [name]: { ...prev[name], [field]: value } }));

  /** Copy the first selected tab's tags down to the rest. */
  const applyToAll = () => {
    const first = sheets.find((s) => selected.has(s.name));
    if (!first) return;
    const source = tags[first.name];
    setTags((prev) => {
      const next = { ...prev };
      for (const s of sheets) if (selected.has(s.name)) next[s.name] = { ...source };
      return next;
    });
  };

  const toggle = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const chosen = sheets.filter((s) => selected.has(s.name));
  const totalRecords = chosen.reduce((sum, s) => sum + s.rows.length, 0);
  const skippedRateData = sheets.filter((s) => s.isRateData && !selected.has(s.name));

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="card-header-row">
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Layers size={20} color="#255CA9" />
              <span>Choose Workbook Tabs</span>
            </h2>
            <span className="app-subtitle">
              <strong>{fileName}</strong> contains {sheets.length} tabs. Tabs that look like rate
              data are already selected.
            </span>
          </div>
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
        </div>

        <div className="table-container" style={{ marginBottom: '16px' }}>
          <table className="randstad-table">
            <thead>
              <tr>
                <th style={{ width: '60px' }}>Include</th>
                <th>Tab</th>
                <th style={{ textAlign: 'right' }}>Rows</th>
                <th style={{ textAlign: 'right' }}>Records</th>
                <th>Rate Years</th>
                <th>Client</th>
                <th>Country</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {sheets.map((sheet) => (
                <tr key={sheet.name} style={{ opacity: sheet.isRateData ? 1 : 0.6 }}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(sheet.name)}
                      onChange={() => toggle(sheet.name)}
                      aria-label={`Include tab ${sheet.name}`}
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                  </td>
                  <td style={{ fontWeight: 600 }}>{sheet.name}</td>
                  <td style={{ textAlign: 'right' }}>{sheet.sourceRowCount}</td>
                  <td style={{ textAlign: 'right' }}>{sheet.rows.length}</td>
                  <td>{sheet.detectedYears.length ? sheet.detectedYears.join(', ') : '—'}</td>
                  <td>
                    <input
                      type="text"
                      className="form-control"
                      style={{ width: '150px' }}
                      placeholder="e.g. National Average"
                      disabled={!selected.has(sheet.name)}
                      value={tags[sheet.name]?.client ?? ''}
                      onChange={(e) => setTag(sheet.name, 'client', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      className="form-control"
                      style={{ width: '140px' }}
                      placeholder="e.g. United States"
                      disabled={!selected.has(sheet.name)}
                      value={tags[sheet.name]?.country ?? ''}
                      onChange={(e) => setTag(sheet.name, 'country', e.target.value)}
                    />
                  </td>
                  <td>
                    {sheet.isRateData ? (
                      <span className="status-pill success">Rate data</span>
                    ) : (
                      <span className="status-pill info">{sheet.reason}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Selecting a tab the parser did not recognise is allowed, but it will
            need its columns mapping by hand on the next screen. */}
        {chosen.some((s) => !s.isRateData) && (
          <div
            className="tonal-card-sub"
            style={{
              marginBottom: '16px',
              backgroundColor: 'rgba(233, 162, 4, 0.12)',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <AlertTriangle size={18} color="#E9A204" />
            <span style={{ fontSize: '0.85rem', color: '#001D35' }}>
              A selected tab was not recognised as rate data. You can still map its columns by hand
              on the next screen.
            </span>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <button
            className="btn-secondary"
            onClick={applyToAll}
            disabled={chosen.length < 2}
            style={{ opacity: chosen.length < 2 ? 0.5 : 1, fontSize: '0.85rem' }}
          >
            <Copy size={14} />
            <span>Apply first tab's client and country to all selected</span>
          </button>
          <span className="text-meta">
            Leave blank to set one value for the whole upload on the next screen.
          </span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '12px' }}>
          <span className="text-meta" style={{ marginRight: 'auto' }}>
            {chosen.length} of {sheets.length} tabs selected · {totalRecords} records
            {skippedRateData.length > 0 &&
              ` · ${skippedRateData.length} rate-data tab${skippedRateData.length === 1 ? '' : 's'} excluded`}
          </span>
          <button className="btn-secondary" onClick={onCancel}>Back to Upload</button>
          <button
            className="btn-primary"
            onClick={() => onConfirm(chosen, tags)}
            disabled={chosen.length === 0}
            style={{ opacity: chosen.length ? 1 : 0.5, cursor: chosen.length ? 'pointer' : 'not-allowed' }}
          >
            <CheckCircle2 size={16} />
            <span>Continue with {chosen.length} tab{chosen.length === 1 ? '' : 's'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
