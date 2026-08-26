import React, { useState } from 'react';
import { CheckCircle2, HelpCircle, ShieldCheck } from 'lucide-react';
import { useRateCard } from '../../context/RateCardContext';
import { ColumnMapping, TargetFieldType, IngestionPreviewData } from '../../types/rateCard';
import { normalizeRawData } from '../../services/parserService';
import { formatDateRandstad } from '../../utils/formatters';

const CORE_OPTIONS: { value: TargetFieldType; label: string }[] = [
  { value: 'jobTitle',  label: 'Job Title' },
  { value: 'laborType', label: 'Labor Type' },
  { value: 'minRate',   label: 'Min Pay' },
  { value: 'maxRate',   label: 'Max Pay' },
  { value: 'rateYear',  label: 'Rate Year' },
  { value: 'client',    label: 'Client / Account' },
  { value: 'country',   label: 'Country' },
  { value: 'ignore',    label: '— Do Not Map (Ignore) —' },
];

/**
 * Null guard only. All state lives in the inner component so hook order stays
 * constant — an early return above `useState` changes the hook count the moment
 * a file is parsed and crashes React.
 *
 * The `key` also gives each upload fresh state, so a second file in the same
 * session does not inherit the first file's edits.
 */
export const ColumnMappingModal: React.FC = () => {
  const { previewData } = useRateCard();
  if (!previewData) return null;
  return <ColumnMappingForm key={previewData.fileName} previewData={previewData} />;
};

const ColumnMappingForm: React.FC<{ previewData: IngestionPreviewData }> = ({ previewData }) => {
  const { setPreviewData, ingestNewBatch } = useRateCard();

  const [mappings, setMappings] = useState<ColumnMapping[]>(previewData.mappings);
  const [client, setClient] = useState<string>(previewData.detectedClient ?? '');
  const [country, setCountry] = useState<string>(previewData.detectedCountry ?? '');

  const handleTargetChange = (index: number, newTarget: TargetFieldType) => {
    setMappings((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], targetField: newTarget, isAutoMapped: false };
      return updated;
    });
  };

  // A batch must be attributable to a client and a country, otherwise records
  // from different markets end up averaged together in the variance table.
  const canConfirm = Boolean(client.trim() && country.trim());

  const handleConfirmIngestion = async () => {
    if (!canConfirm) return;
    const batchId = `batch-${Date.now()}`;
    const uploadedAt = new Date().toISOString();
    const batchMeta = { client: client.trim(), country: country.trim() };

    const records = normalizeRawData(previewData, mappings, batchMeta, batchId, uploadedAt);
    const years = Array.from(new Set(records.map((r) => r.rateYear))).sort();
    await ingestNewBatch(records, previewData.fileName, batchMeta, batchId, uploadedAt, years);
  };

  /**
   * Explain where a batch tag came from. A mapped column pre-fills the input but
   * does not lock it — the field below still overrides the whole batch.
   */
  const detectionHint = (field: TargetFieldType): string => {
    const mapping = mappings.find((m) => m.targetField === field);
    return mapping
      ? `Detected from the "${mapping.rawHeader}" column; edit to override the whole batch.`
      : 'No matching column found — this value is applied to every row.';
  };

  const years = previewData.detectedYears ?? [];

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="card-header-row">
          <div>
            <h2>Review Column Mapping &amp; Ingestion Schema</h2>
            <span className="app-subtitle">
              Source file: <strong>{previewData.fileName}</strong> ({previewData.rawRows.length} records)
            </span>
            {years.length > 0 && (
              <div style={{ marginTop: '6px' }}>
                <span className="status-pill info">
                  {years.length} rate {years.length === 1 ? 'year' : 'years'} detected
                  {previewData.sourceRowCount !== undefined &&
                    ` — ${previewData.sourceRowCount} source rows expanded to ${previewData.rawRows.length} records`}
                </span>
                <span className="text-meta" style={{ display: 'block', marginTop: '4px' }}>
                  {years.join(', ')}
                </span>
              </div>
            )}
          </div>
          <button className="btn-secondary" onClick={() => setPreviewData(null)}>
            Cancel
          </button>
        </div>

        {/* Batch tags applied to every row of this upload */}
        <div className="tonal-card-sub" style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <label className="form-label">Client / Account</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. National Average"
                value={client}
                onChange={(e) => setClient(e.target.value)}
              />
              <span style={{ fontSize: '0.78rem', color: '#415E7D' }}>{detectionHint('client')}</span>
            </div>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <label className="form-label">Country</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. United States"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              />
              <span style={{ fontSize: '0.78rem', color: '#415E7D' }}>{detectionHint('country')}</span>
            </div>
          </div>
          <p style={{ fontSize: '0.85rem', color: '#415E7D', marginTop: '12px', marginBottom: 0 }}>
            {/* The rate year comes from the column headers; the upload date is
                recorded so a later re-upload of a year can be compared. */}
            Rates are filed under the years in the column headers
            {years.length > 0 && <> (<strong>{years.join(', ')}</strong>)</>}, recorded as uploaded on{' '}
            <strong>{formatDateRandstad(new Date().toISOString().slice(0, 10))}</strong>.
          </p>
        </div>

        {previewData.validationErrors.length > 0 && (
          <div
            className="tonal-card-sub"
            style={{ marginBottom: '20px', backgroundColor: 'rgba(233, 162, 4, 0.12)' }}
          >
            {previewData.validationErrors.map((err) => (
              <div key={err} style={{ fontSize: '0.85rem', color: '#001D35' }}>
                {err}
              </div>
            ))}
          </div>
        )}

        {/* Column Mapping Grid */}
        <div className="table-container" style={{ marginBottom: '16px' }}>
          <table className="randstad-table">
            <thead>
              <tr>
                <th>Source Header</th>
                <th>Sample Values</th>
                <th>Confidence</th>
                <th>Target Field Mapping</th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((map, idx) => (
                <tr key={map.rawHeader}>
                  <td style={{ fontWeight: 600, color: '#255CA9' }}>{map.rawHeader}</td>
                  <td style={{ fontSize: '0.8rem', color: '#415E7D' }}>
                    {map.sampleValues.join(', ') || '—'}
                  </td>
                  <td>
                    {map.confidence >= 0.8 ? (
                      <span className="status-pill success">
                        <ShieldCheck size={14} /> Auto-Mapped ({Math.round(map.confidence * 100)}%)
                      </span>
                    ) : (
                      <span className="status-pill warning">
                        <HelpCircle size={14} /> Manual Check
                      </span>
                    )}
                  </td>
                  <td>
                    <select
                      className="form-control"
                      value={map.targetField}
                      onChange={(e) => handleTargetChange(idx, e.target.value as TargetFieldType)}
                    >
                      {CORE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '12px' }}>
          {!canConfirm && (
            <span style={{ fontSize: '0.8rem', color: '#E9A204', marginRight: 'auto' }}>
              Enter a client and a country to continue.
            </span>
          )}
          <button className="btn-secondary" onClick={() => setPreviewData(null)}>
            Back to Upload
          </button>
          <button
            className="btn-primary"
            onClick={handleConfirmIngestion}
            disabled={!canConfirm}
            style={{ opacity: canConfirm ? 1 : 0.5, cursor: canConfirm ? 'pointer' : 'not-allowed' }}
          >
            <CheckCircle2 size={16} />
            <span>Confirm &amp; Save to Domo Collection</span>
          </button>
        </div>
      </div>
    </div>
  );
};
