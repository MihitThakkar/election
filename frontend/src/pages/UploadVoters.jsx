import { useState, useEffect, useRef } from 'react';
import { Upload, FileSpreadsheet, CheckCircle, Download, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import api from '../utils/api';
import { getApiError } from '../utils/helpers';
import ErrorAlert from '../components/ErrorAlert';

const MULTIPART_HEADERS = { 'Content-Type': 'multipart/form-data' };

export default function UploadVoters() {
  const [areas, setAreas]           = useState([]);
  const [areaId, setAreaId]         = useState('');
  const [file, setFile]             = useState(null);
  const [preview, setPreview]       = useState([]);
  const [previewHeaders, setPreviewHeaders] = useState([]);
  const [uploading, setUploading]   = useState(false);
  const [result, setResult]         = useState(null);
  const [error, setError]           = useState('');
  const [dragging, setDragging]     = useState(false);
  const fileRef = useRef();

  // Correct: useEffect for side effects, not useState initializer
  useEffect(() => {
    api.get('/areas').then(r => setAreas(r.data.data));
  }, []);

  const processFile = (f) => {
    setFile(f); setResult(null); setError('');
    const reader = new FileReader();
    reader.onload = (e) => {
      const wb   = XLSX.read(e.target.result, { type: 'array' });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (rows.length === 0) return;
      setPreviewHeaders(rows[0].map(String));
      setPreview(rows.slice(1, 11));
    };
    reader.readAsArrayBuffer(f);
  };

  const handleDrop = (e) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) processFile(f);
  };

  const handleFileChange = (e) => {
    const f = e.target.files[0];
    if (f) processFile(f);
  };

  const clearFile = (e) => {
    e.stopPropagation();
    setFile(null); setPreview([]); setPreviewHeaders([]);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true); setError(''); setResult(null);
    const formData = new FormData();
    formData.append('file', file);
    if (areaId) formData.append('area_id', areaId);
    try {
      const res = await api.post('/voters/upload', formData, { headers: MULTIPART_HEADERS });
      setResult(res.data.data);
      setFile(null); setPreview([]); setPreviewHeaders([]);
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      setError(getApiError(err, 'Upload failed'));
    } finally {
      setUploading(false);
    }
  };

  const downloadSample = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['name', 'age', 'voter_id', 'father_name', 'phone', 'address', 'gender'],
      ['Ramesh Kumar', 28, 'UP1234567', 'Suresh Kumar', '9812345678', 'H-12, Gandhi Nagar', 'M'],
      ['Priya Sharma', 22, 'UP1234568', 'Mohan Sharma', '9812345679', 'H-15, Gandhi Nagar', 'F'],
      ['Anil Singh',   35, 'UP1234569', 'Balveer Singh','9812345680', 'H-18, Gandhi Nagar', 'M'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Voters');
    XLSX.writeFile(wb, 'voter_list_sample.xlsx');
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="page-header">
        <div className="anim-up">
          <h1 className="page-title">Upload Voter List</h1>
          <p className="page-subtitle">Import voter data from Excel or CSV file</p>
        </div>
        <button onClick={downloadSample} className="btn-secondary text-sm anim-up anim-d1">
          <Download size={15} /> Download Sample
        </button>
      </div>

      {/* Success Result */}
      {result && (
        <div className="card p-6 anim-scale" style={{ borderLeft: '3px solid var(--text)' }}>
          <div className="flex items-center gap-3 mb-4">
            <CheckCircle size={22} style={{ color: 'var(--text)' }} />
            <h3 className="font-bold text-lg" style={{ color: 'var(--text)' }}>Import Successful</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Total Rows',       value: result.total },
              { label: 'Imported',         value: result.imported },
              { label: 'Skipped (dups)',   value: result.skipped },
              { label: 'Eligible (18–35)', value: result.eligible },
            ].map(s => (
              <div key={s.label} className="rounded-lg p-3" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
                <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>{s.label}</div>
                <div className="text-2xl font-bold mt-1" style={{ color: 'var(--text)' }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Area Selection */}
      <div className="card p-5 anim-up anim-d1">
        <label className="label">Assign to Area (optional)</label>
        <select className="input max-w-sm" value={areaId} onChange={e => setAreaId(e.target.value)}>
          <option value="">— No area assignment —</option>
          {areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <p className="text-xs text-slate-500 mt-2">Voters will be associated with this area on import.</p>
      </div>

      {/* Upload Zone */}
      <div className="card p-5 anim-up anim-d2">
        <div
          onDrop={handleDrop}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onClick={() => fileRef.current?.click()}
          className={`border-2 border-dashed rounded-xl cursor-pointer transition-all py-12 px-6 text-center`}
          style={{
            borderColor: dragging ? 'var(--text)' : 'var(--border)',
            background: dragging ? 'var(--bg)' : 'transparent',
          }}
        >
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileChange} />
          {file ? (
            <div>
              <FileSpreadsheet size={36} className="mx-auto mb-3" style={{ color: 'var(--text-2)' }} />
              <p className="font-semibold" style={{ color: 'var(--text)' }}>{file.name}</p>
              <p className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>{(file.size/1024).toFixed(1)} KB · Click to change</p>
              <button type="button" onClick={clearFile}
                className="mt-3 inline-flex items-center gap-1 text-xs transition-opacity hover:opacity-60"
                style={{ color: 'var(--text-3)' }}>
                <X size={11} /> Remove file
              </button>
            </div>
          ) : (
            <div>
              <Upload size={36} className="mx-auto mb-3 opacity-20" style={{ color: 'var(--text)' }} />
              <p className="font-semibold" style={{ color: 'var(--text-2)' }}>Drag & drop your Excel/CSV file here</p>
              <p className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>or click to browse · .xlsx, .xls, .csv</p>
            </div>
          )}
        </div>

        <ErrorAlert message={error} />

        {file && (
          <button onClick={handleUpload} disabled={uploading} className="btn-primary mt-4 w-full justify-center py-3">
            {uploading
              ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Importing...</>
              : <><Upload size={15} /> Import {file.name}</>}
          </button>
        )}
      </div>

      {/* Preview Table */}
      {preview.length > 0 && (
        <div className="card overflow-hidden anim-up">
          <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
            <h3 className="font-bold" style={{ color: 'var(--text)' }}>File Preview (first 10 rows)</h3>
            <span className="badge-slate">{previewHeaders.length} columns</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {previewHeaders.map((h, i) => (
                    <th key={i} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap"
                      style={{ color: 'var(--text-3)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, ri) => (
                  <tr key={ri} className="transition-colors hover:bg-[#fafafa]"
                    style={{ borderBottom: '1px solid var(--border)' }}>
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-3 py-2 whitespace-nowrap max-w-[150px] truncate"
                        style={{ color: 'var(--text-2)' }}>{String(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Column Guide */}
      <div className="card p-5 anim-up anim-d3">
        <h3 className="font-bold mb-3" style={{ color: 'var(--text)' }}>Supported Column Names</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
          {[
            { field: 'Voter Name',      variants: 'name, voter_name, full_name, नाम',  required: true },
            { field: 'Age',             variants: 'age, उम्र, आयु',                     required: true },
            { field: 'Voter ID (EPIC)', variants: 'voter_id, epic, voter_card_no',      required: true },
            { field: 'Father Name',     variants: 'father_name, father, guardian' },
            { field: 'Phone',           variants: 'phone, mobile, contact' },
            { field: 'Address',         variants: 'address, house, पता' },
            { field: 'Gender',          variants: 'gender, sex (M/F/Male/Female)' },
          ].map(c => (
            <div key={c.field} className="flex items-start gap-2 p-2.5 rounded-lg"
              style={{ background: 'var(--bg)' }}>
              <span className={`flex-shrink-0 mt-0.5 ${c.required ? 'badge-green' : 'badge-slate'}`}>
                {c.required ? 'Required' : 'Optional'}
              </span>
              <div>
                <div className="font-semibold" style={{ color: 'var(--text)' }}>{c.field}</div>
                <div className="text-xs font-mono mt-0.5" style={{ color: 'var(--text-3)' }}>{c.variants}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
