import React, { useMemo, useRef, useState } from 'react';
import {
  UploadCloud,
  Tags,
  AlertTriangle,
  Search,
  Trash2,
  CheckCircle2,
  CircleSlash,
} from 'lucide-react';
import { useRateCard } from '../../context/RateCardContext';
import {
  buildTitleMappings,
  mappingCoverage,
  readTitleMappingFile,
} from '../../services/titleMappingService';
import { MappingColumn, MappingTargetField, TitleMappingPreview } from '../../types/rateCard';
import { normalizeJobTitle } from '../../services/titleService';
import { toDomoDateTime } from '../../utils/formatters';

/**
 * The uploaded title mapping file.
 *
 * This is the replacement for deciding titles one at a time in the app, and it
 * is deliberately a different shape of thing. The interactive matcher exists
 * because matching a card title to a title Domo holds is a judgement, made per
 * client, with evidence to weigh. A standard-title taxonomy is not a judgement
 * — it is a decision already taken elsewhere, and the app's job is to load it
 * faithfully and then say plainly how much of the card it covers.
 *
 * So there is no scoring here and nothing to accept or reject. There is a file,
 * a column confirmation, and a coverage figure.
 */

const FIELD_LABELS: Record<MappingTargetField, string> = {
  uploadedTitle: 'Uploaded title',
  standardTitle: 'Standard title',
  family: 'Family',
  level: 'Level',
  ignore: 'Ignore',
};

export const TitleMappingPanel: React.FC = () => {
  const { titleMappings, loadTitleMappings, clearTitleMappings, scopedRateCards } = useRateCard();

  const [preview, setPreview] = useState<TitleMappingPreview | null>(null);
  const [columns, setColumns] = useState<MappingColumn[]>([]);
  const [isHovered, setIsHovered] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const coverage = useMemo(
    () => mappingCoverage(scopedRateCards, titleMappings),
    [scopedRateCards, titleMappings]
  );

  /** Normalized titles present in the cards, for the "in a card" column. */
  const cardTitleKeys = useMemo(
    () => new Set(scopedRateCards.map((r) => normalizeJobTitle(r.jobTitle || '')).filter(Boolean)),
    [scopedRateCards]
  );

  const processFile = async (file: File) => {
    setIsReading(true);
    setErrorMessage(null);
    try {
      const read = await readTitleMappingFile(file);
      setPreview(read);
      setColumns(read.columns);
    } catch (err: any) {
      setErrorMessage(`Could not read that file: ${err?.message || 'invalid format'}`);
    } finally {
      setIsReading(false);
    }
  };

  const cancelPreview = () => {
    setPreview(null);
    setColumns([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const confirmPreview = async () => {
    if (!preview) return;
    setIsSaving(true);
    try {
      const { mappings } = buildTitleMappings(preview, columns, toDomoDateTime());
      if (!mappings.length) {
        setErrorMessage(
          'No usable rows — every row was missing an uploaded title or a standard title.'
        );
        return;
      }
      if (await loadTitleMappings(mappings)) cancelPreview();
    } finally {
      setIsSaving(false);
    }
  };

  const setColumnField = (rawHeader: string, targetField: MappingTargetField) =>
    setColumns((prev) =>
      prev.map((c) =>
        // Only one column can hold each field, so claiming one releases
        // whichever column held it before. Two columns both marked "standard
        // title" would otherwise silently pick whichever came first.
        c.rawHeader === rawHeader
          ? { ...c, targetField }
          : targetField !== 'ignore' && c.targetField === targetField
          ? { ...c, targetField: 'ignore' }
          : c
      )
    );

  const filteredMappings = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = term
      ? titleMappings.filter(
          (m) =>
            m.uploadedTitle.toLowerCase().includes(term) ||
            m.standardTitle.toLowerCase().includes(term) ||
            (m.family || '').toLowerCase().includes(term) ||
            (m.level || '').toLowerCase().includes(term)
        )
      : titleMappings;
    return [...list].sort((a, b) =>
      a.uploadedTitle.localeCompare(b.uploadedTitle, undefined, { numeric: true })
    );
  }, [titleMappings, search]);

  const build = preview ? buildTitleMappings(preview, columns, '') : null;

  return (
    <>
      <div className="tonal-card">
        <div className="card-header-row">
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Tags size={20} color="#255CA9" />
              <span>Title Mappings</span>
            </h2>
            <span className="app-subtitle">
              Uploaded job titles mapped to your standard titles · needs no Domo connection
            </span>
          </div>
          {titleMappings.length > 0 && (
            <button
              className="btn-secondary"
              onClick={() => {
                if (window.confirm(`Remove all ${titleMappings.length} stored mappings?`)) {
                  clearTitleMappings();
                }
              }}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Trash2 size={15} />
              Clear all
            </button>
          )}
        </div>

        {errorMessage && (
          <div className="status-pill error" style={{ marginBottom: '14px' }}>
            <AlertTriangle size={14} />
            {errorMessage}
          </div>
        )}

        {!preview ? (
          <>
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
                {isReading ? 'Reading…' : 'Drop the mapping file here, or click to choose'}
              </div>
              <div className="text-meta" style={{ marginTop: '4px' }}>
                CSV or Excel. One row per uploaded title, with the standard title beside it.
                Family and level are read if the file carries them.
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
            </div>

            {titleMappings.length > 0 && (
              <div className="text-meta" style={{ marginTop: '12px' }}>
                {titleMappings.length} mapping{titleMappings.length === 1 ? '' : 's'} stored
                {titleMappings[0]?.sourceFileName
                  ? ` from ${titleMappings[0].sourceFileName}`
                  : ''}
                . Uploading another file replaces them all — the file is the taxonomy, so a title
                it no longer lists has been retired from it.
              </div>
            )}
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <span style={{ fontWeight: 600 }}>{preview.fileName}</span>
              <span className="text-meta">
                {' '}
                · sheet &ldquo;{preview.sheetName}&rdquo; · {preview.rows.length} row
                {preview.rows.length === 1 ? '' : 's'}
              </span>
              {preview.otherSheets.length > 0 && (
                <div className="text-meta">
                  Other sheets with rows were ignored: {preview.otherSheets.join(', ')}
                </div>
              )}
            </div>

            <div className="table-container">
              <table className="randstad-table">
                <thead>
                  <tr>
                    <th>Column in file</th>
                    <th>Sample values</th>
                    <th>Read as</th>
                  </tr>
                </thead>
                <tbody>
                  {columns.map((column) => (
                    <tr key={column.rawHeader}>
                      <td style={{ fontWeight: 600 }}>{column.rawHeader}</td>
                      <td className="text-meta">{column.sampleValues.join(' · ') || '—'}</td>
                      <td>
                        <select
                          className="form-control"
                          style={{ width: '180px' }}
                          value={column.targetField}
                          onChange={(e) =>
                            setColumnField(column.rawHeader, e.target.value as MappingTargetField)
                          }
                        >
                          {(Object.keys(FIELD_LABELS) as MappingTargetField[]).map((field) => (
                            <option key={field} value={field}>
                              {FIELD_LABELS[field]}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {build && (
              <div className="text-meta">
                {build.mappings.length} mapping{build.mappings.length === 1 ? '' : 's'} will be
                stored
                {build.skipped > 0 &&
                  ` · ${build.skipped} row(s) skipped for a missing uploaded or standard title`}
                {build.duplicates.length > 0 &&
                  ` · ${build.duplicates.length} duplicate uploaded title(s) kept at their first spelling: ${build.duplicates
                    .slice(0, 5)
                    .join(', ')}`}
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                className="btn-primary"
                onClick={confirmPreview}
                disabled={isSaving || !build?.mappings.length}
              >
                {isSaving ? 'Storing…' : `Store ${build?.mappings.length ?? 0} mappings`}
              </button>
              <button className="btn-secondary" onClick={cancelPreview} disabled={isSaving}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Coverage. The point of the file is how much of the card it explains,
          so that is reported next to it rather than left to be worked out. */}
      {titleMappings.length > 0 && (
        <div className="tonal-card">
          <div className="card-header-row">
            <div>
              <h2 style={{ fontSize: '1.05rem' }}>Coverage</h2>
              <span className="app-subtitle">
                How far the mapping file reaches across the rate card records in scope
              </span>
            </div>
          </div>

          <div className="kpi-grid">
            <div className="kpi-card">
              <span className="kpi-label">Titles mapped</span>
              <span className="display-metric">{coverage.mapped.length}</span>
              <span className="text-meta">
                {coverage.mapped.reduce((n, m) => n + m.recordCount, 0)} record(s)
              </span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Titles unmapped</span>
              <span
                className="display-metric"
                style={{ color: coverage.unmapped.length ? 'var(--status-warning)' : undefined }}
              >
                {coverage.unmapped.length}
              </span>
              <span className="text-meta">
                {coverage.unmapped.reduce((n, m) => n + m.recordCount, 0)} record(s)
              </span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Mappings unused</span>
              <span className="display-metric">{coverage.unusedMappings}</span>
              <span className="text-meta">match no title in any ingested card</span>
            </div>
          </div>

          {coverage.unmapped.length > 0 && (
            <div style={{ marginTop: '16px' }}>
              <span className="status-pill warning" style={{ marginBottom: '10px' }}>
                <CircleSlash size={13} />
                {coverage.unmapped.length} card title
                {coverage.unmapped.length === 1 ? '' : 's'} with no mapping
              </span>
              <div className="table-container" style={{ marginTop: '10px' }}>
                <table className="randstad-table">
                  <thead>
                    <tr>
                      <th>Uploaded title</th>
                      <th style={{ textAlign: 'right' }}>Records</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Heaviest first: twenty titles carrying one row each
                        matter less than one carrying two hundred. */}
                    {coverage.unmapped.slice(0, 50).map((row) => (
                      <tr key={row.uploadedTitle}>
                        <td>{row.uploadedTitle}</td>
                        <td style={{ textAlign: 'right' }}>{row.recordCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {coverage.unmapped.length > 50 && (
                <div className="text-meta" style={{ marginTop: '8px' }}>
                  Showing the 50 heaviest of {coverage.unmapped.length}.
                </div>
              )}
            </div>
          )}

          {coverage.unmapped.length === 0 && (
            <div className="tonal-card-sub" style={{ marginTop: '14px' }}>
              <span
                className="text-meta"
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <CheckCircle2 size={14} color="#257F56" />
                Every job title in the ingested cards in scope has a standard title.
              </span>
            </div>
          )}
        </div>
      )}

      {titleMappings.length > 0 && (
        <div className="tonal-card">
          <div className="card-header-row">
            <div>
              <h2 style={{ fontSize: '1.05rem' }}>Stored mappings</h2>
              <span className="app-subtitle">
                {filteredMappings.length} of {titleMappings.length}
              </span>
            </div>
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
                placeholder="Search titles, family or level..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="table-container">
            <table className="randstad-table">
              <thead>
                <tr>
                  <th>Uploaded title</th>
                  <th>Standard title</th>
                  <th>Family</th>
                  <th>Level</th>
                  <th style={{ textAlign: 'center' }}>In a card</th>
                </tr>
              </thead>
              <tbody>
                {filteredMappings.slice(0, 300).map((mapping) => {
                  const inUse = cardTitleKeys.has(mapping.uploadedTitleKey);
                  return (
                    <tr key={mapping.id}>
                      <td>{mapping.uploadedTitle}</td>
                      <td style={{ fontWeight: 600 }}>{mapping.standardTitle}</td>
                      <td className="text-meta">{mapping.family || '—'}</td>
                      <td className="text-meta">{mapping.level || '—'}</td>
                      <td style={{ textAlign: 'center' }}>
                        {inUse ? (
                          <CheckCircle2 size={15} color="#257F56" />
                        ) : (
                          <span className="text-meta">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filteredMappings.length > 300 && (
            <div className="text-meta" style={{ marginTop: '8px' }}>
              Showing the first 300 of {filteredMappings.length}.
            </div>
          )}
        </div>
      )}
    </>
  );
};
