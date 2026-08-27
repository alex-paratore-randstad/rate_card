import React, { useState } from 'react';
import { CheckCircle2, Layers, AlertTriangle } from 'lucide-react';
import { SheetSummary } from '../../services/parserService';

interface Props {
  fileName: string;
  sheets: SheetSummary[];
  onCancel: () => void;
  onConfirm: (selected: SheetSummary[]) => void;
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

        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '12px' }}>
          <span className="text-meta" style={{ marginRight: 'auto' }}>
            {chosen.length} of {sheets.length} tabs selected · {totalRecords} records
            {skippedRateData.length > 0 &&
              ` · ${skippedRateData.length} rate-data tab${skippedRateData.length === 1 ? '' : 's'} excluded`}
          </span>
          <button className="btn-secondary" onClick={onCancel}>Back to Upload</button>
          <button
            className="btn-primary"
            onClick={() => onConfirm(chosen)}
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
