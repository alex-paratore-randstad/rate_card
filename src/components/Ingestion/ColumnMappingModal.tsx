import React, { useState } from 'react';
import { CheckCircle2, HelpCircle, ShieldCheck, PlusCircle, X } from 'lucide-react';
import { useRateCard } from '../../context/RateCardContext';
import { ColumnMapping, TargetFieldType, FieldDefinition } from '../../types/rateCard';
import { normalizeRawData } from '../../services/parserService';
import { labelToKey } from '../../services/fieldService';

const CORE_OPTIONS: { value: TargetFieldType; label: string }[] = [
  { value: 'jobTitle',       label: 'Job Title / Role' },
  { value: 'minRate',        label: 'Min Pay Rate' },
  { value: 'maxRate',        label: 'Max Pay Rate' },
  { value: 'effectiveMonth', label: 'Effective Month / Date' },
  { value: 'category',       label: 'Job Category / Practice' },
  { value: 'region',         label: 'Geography / Region' },
  { value: 'skillLevel',     label: 'Seniority / Skill Level' },
  { value: 'laborType',      label: 'Labor Type / Worker Type' },
  { value: 'currency',       label: 'Currency Code' },
  { value: 'ignore',         label: '— Do Not Map (Ignore) —' },
];

export const ColumnMappingModal: React.FC = () => {
  const { previewData, setPreviewData, ingestNewBatch, fieldDefinitions, addField } = useRateCard();

  if (!previewData) return null;

  const [mappings, setMappings] = useState<ColumnMapping[]>(previewData.mappings);
  const [effectiveMonth, setEffectiveMonth] = useState<string>(
    previewData.detectedMonth || new Date().toISOString().slice(0, 7)
  );

  // Inline "Add new field" state
  const [showAddField, setShowAddField] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldType, setNewFieldType] = useState<'text' | 'number'>('text');
  const [addFieldError, setAddFieldError] = useState('');

  const handleTargetChange = (index: number, newTarget: TargetFieldType) => {
    setMappings((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], targetField: newTarget, isAutoMapped: false };
      return updated;
    });
  };

  const handleConfirmIngestion = async () => {
    const normalizedRecords = normalizeRawData(previewData, mappings, effectiveMonth, fieldDefinitions);
    await ingestNewBatch(normalizedRecords, previewData.fileName, effectiveMonth);
  };

  const handleAddField = async () => {
    const trimmed = newFieldLabel.trim();
    if (!trimmed) {
      setAddFieldError('Please enter a field name.');
      return;
    }
    const key = labelToKey(trimmed);
    if (fieldDefinitions.some((f) => f.key === key)) {
      setAddFieldError(`A field with key "${key}" already exists.`);
      return;
    }
    const newField: FieldDefinition = { key, label: trimmed, fieldType: newFieldType };
    await addField(newField);
    setNewFieldLabel('');
    setNewFieldType('text');
    setAddFieldError('');
    setShowAddField(false);
  };

  // Build dropdown options: core + all custom fields from registry
  const allOptions: { value: TargetFieldType; label: string; isCustom?: boolean }[] = [
    ...CORE_OPTIONS.filter((o) => o.value !== 'ignore'),
    ...fieldDefinitions.map((f) => ({
      value: `custom:${f.key}` as TargetFieldType,
      label: f.label,
      isCustom: true,
    })),
    { value: 'ignore', label: '— Do Not Map (Ignore) —' },
  ];

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="card-header-row">
          <div>
            <h2>Review Column Mapping &amp; Ingestion Schema</h2>
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
                      <optgroup label="Core Fields">
                        {allOptions
                          .filter((o) => !o.isCustom && o.value !== 'ignore')
                          .map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                      </optgroup>
                      {fieldDefinitions.length > 0 && (
                        <optgroup label="Custom Fields">
                          {allOptions
                            .filter((o) => o.isCustom)
                            .map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </optgroup>
                      )}
                      <option value="ignore">— Do Not Map (Ignore) —</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Add New Field */}
        <div className="tonal-card-sub" style={{ marginBottom: '24px' }}>
          {!showAddField ? (
            <button
              className="btn-secondary"
              onClick={() => setShowAddField(true)}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem' }}
            >
              <PlusCircle size={16} />
              Add new target field to mapping options
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 600, fontSize: '0.875rem', color: '#255CA9' }}>
                  Add New Custom Field
                </span>
                <button
                  onClick={() => { setShowAddField(false); setAddFieldError(''); setNewFieldLabel(''); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#415E7D' }}
                >
                  <X size={16} />
                </button>
              </div>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ flex: 2, minWidth: '200px' }}>
                  <label className="form-label">Field Label</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="e.g. MRA Min Suggested Bill Rate"
                    value={newFieldLabel}
                    onChange={(e) => { setNewFieldLabel(e.target.value); setAddFieldError(''); }}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddField()}
                  />
                </div>
                <div style={{ flex: 1, minWidth: '120px' }}>
                  <label className="form-label">Value Type</label>
                  <select
                    className="form-control"
                    value={newFieldType}
                    onChange={(e) => setNewFieldType(e.target.value as 'text' | 'number')}
                  >
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                  </select>
                </div>
                <button className="btn-primary" onClick={handleAddField} style={{ flexShrink: 0 }}>
                  <PlusCircle size={14} /> Add Field
                </button>
              </div>
              {newFieldLabel && (
                <span style={{ fontSize: '0.78rem', color: '#415E7D' }}>
                  Will be saved as key: <code>{labelToKey(newFieldLabel)}</code>
                </span>
              )}
              {addFieldError && (
                <span style={{ fontSize: '0.8rem', color: '#D9341B' }}>{addFieldError}</span>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button className="btn-secondary" onClick={() => setPreviewData(null)}>
            Back to Upload
          </button>
          <button className="btn-primary" onClick={handleConfirmIngestion}>
            <CheckCircle2 size={16} />
            <span>Confirm &amp; Publish to Domo Collection</span>
          </button>
        </div>
      </div>
    </div>
  );
};
