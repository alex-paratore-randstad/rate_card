import React, { useState } from 'react';
import { CheckCircle2, HelpCircle, ShieldCheck } from 'lucide-react';
import { useRateCard } from '../../context/RateCardContext';
import { ColumnMapping, TargetFieldType } from '../../types/rateCard';
import { normalizeRawData } from '../../services/parserService';

export const ColumnMappingModal: React.FC = () => {
  const { previewData, setPreviewData, ingestNewBatch } = useRateCard();

  if (!previewData) return null;

  const [mappings, setMappings] = useState<ColumnMapping[]>(previewData.mappings);
  const [effectiveMonth, setEffectiveMonth] = useState<string>(
    previewData.detectedMonth || new Date().toISOString().slice(0, 7)
  );

  const handleTargetChange = (index: number, newTarget: TargetFieldType) => {
    setMappings((prev) => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        targetField: newTarget,
        isAutoMapped: false,
      };
      return updated;
    });
  };

  const handleConfirmIngestion = async () => {
    const normalizedRecords = normalizeRawData(previewData, mappings, effectiveMonth);
    await ingestNewBatch(normalizedRecords, previewData.fileName, effectiveMonth);
  };

  const targetOptions: { value: TargetFieldType; label: string }[] = [
    { value: 'jobTitle', label: 'Job Title / Role' },
    { value: 'minRate', label: 'Minimum Pay Rate (Min Rate)' },
    { value: 'maxRate', label: 'Maximum Pay Rate (Max Rate)' },
    { value: 'effectiveMonth', label: 'Effective Month / Date' },
    { value: 'category', label: 'Job Category / Practice' },
    { value: 'region', label: 'Geography / Region' },
    { value: 'skillLevel', label: 'Seniority / Skill Level' },
    { value: 'currency', label: 'Currency Code' },
    { value: 'ignore', label: '— Do Not Map (Ignore) —' },
  ];

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="card-header-row">
          <div>
            <h2>Review Column Mapping & Ingestion Schema</h2>
            <span className="app-subtitle">
              Source file: <strong>{previewData.fileName}</strong> ({previewData.rawRows.length} rows)
            </span>
          </div>

          <button className="btn-secondary" onClick={() => setPreviewData(null)}>
            Cancel
          </button>
        </div>

        {/* Effective Reporting Month Selector */}
        <div className="tonal-card-sub" style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ flex: 1 }}>
              <label className="form-label">Effective Reporting Month (YYYY-MM):</label>
              <input
                type="month"
                className="form-control"
                value={effectiveMonth}
                onChange={(e) => setEffectiveMonth(e.target.value)}
              />
            </div>
            <div style={{ flex: 2 }}>
              <span className="text-meta">INGESTION VALIDATION</span>
              <p style={{ fontSize: '0.85rem', color: '#415E7D', marginTop: '4px' }}>
                Normalized records will be indexed under <strong>{effectiveMonth}</strong> in the Domo collection.
              </p>
            </div>
          </div>
        </div>

        {/* Column Mapping Grid */}
        <div className="table-container" style={{ marginBottom: '24px' }}>
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
                      {targetOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button className="btn-secondary" onClick={() => setPreviewData(null)}>
            Back to Upload
          </button>
          <button className="btn-primary" onClick={handleConfirmIngestion}>
            <CheckCircle2 size={16} />
            <span>Confirm & Publish to Domo Collection</span>
          </button>
        </div>
      </div>
    </div>
  );
};
