import React, { useState, useRef } from 'react';
import { UploadCloud, FileText, AlertTriangle } from 'lucide-react';
import { parseRateCardFile } from '../../services/parserService';
import { useRateCard } from '../../context/RateCardContext';

export const FileUploader: React.FC = () => {
  const { setPreviewData } = useRateCard();
  const [isHovered, setIsHovered] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pasteContent, setPasteContent] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await processFile(file);
    }
  };

  const processFile = async (file: File) => {
    setIsParsing(true);
    setErrorMessage(null);
    try {
      const parsed = await parseRateCardFile(file);
      setPreviewData(parsed);
    } catch (err: any) {
      setErrorMessage(`Failed to parse file: ${err.message || 'Invalid format'}`);
    } finally {
      setIsParsing(false);
    }
  };

  const handlePasteSubmit = () => {
    if (!pasteContent.trim()) return;
    setIsParsing(true);
    try {
      const blob = new Blob([pasteContent], { type: 'text/csv' });
      const file = new File([blob], 'Pasted_Rate_Card.csv', { type: 'text/csv' });
      processFile(file);
    } catch (err: any) {
      setErrorMessage(`Failed to process pasted data: ${err.message}`);
      setIsParsing(false);
    }
  };

  return (
    <div className="tonal-card">
      <div className="card-header-row">
        <div>
          <h2>Ingest Monthly Rate Card Report</h2>
          <span className="app-subtitle">
            Upload CSV or Excel templates with varying column headers
          </span>
        </div>
        <span className="status-pill info">Auto Column Mapper Ready</span>
      </div>

      {errorMessage && (
        <div
          className="tonal-card-sub"
          style={{
            backgroundColor: 'rgba(224, 15, 15, 0.08)',
            color: '#E00F0F',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <AlertTriangle size={20} />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Drag and Drop Zone */}
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
          if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            processFile(e.dataTransfer.files[0]);
          }
        }}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          accept=".csv,.xlsx,.xls"
          onChange={handleFileChange}
        />
        <UploadCloud size={48} color="#255CA9" style={{ marginBottom: '16px' }} />
        <h3 style={{ marginBottom: '8px' }}>
          {isParsing ? 'Analyzing Column Structures...' : 'Drag & Drop Rate Card Report'}
        </h3>
        <p style={{ color: '#415E7D', fontSize: '0.9rem', marginBottom: '16px' }}>
          Supports .xlsx, .xls, or .csv monthly report templates
        </p>
        <button className="btn-primary" type="button" disabled={isParsing}>
          <FileText size={16} />
          <span>Browse File</span>
        </button>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          margin: '32px 0 20px 0',
        }}
      >
        <div style={{ flex: 1, height: '1px', backgroundColor: 'rgba(194, 198, 211, 0.3)' }} />
        <span className="text-meta">OR PASTE TABULAR DATA</span>
        <div style={{ flex: 1, height: '1px', backgroundColor: 'rgba(194, 198, 211, 0.3)' }} />
      </div>

      {/* Paste CSV Data Textarea */}
      <div className="tonal-card-sub">
        <label className="form-label">Paste CSV Content:</label>
        <textarea
          className="form-control"
          rows={4}
          placeholder="Job Title, Pay Min, Pay Max, Month&#10;Senior Full Stack Engineer, 85, 125, 2026-04&#10;Cloud Solutions Architect, 110, 165, 2026-04"
          value={pasteContent}
          onChange={(e) => setPasteContent(e.target.value)}
        />
        <div style={{ marginTop: '12px', textAlign: 'right' }}>
          <button
            className="btn-secondary"
            onClick={handlePasteSubmit}
            disabled={!pasteContent.trim() || isParsing}
          >
            <span>Process Pasted Data</span>
          </button>
        </div>
      </div>
    </div>
  );
};
