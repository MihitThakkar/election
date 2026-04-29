import { useState, useEffect, useRef } from 'react';
import { Upload, FileSpreadsheet, FileText, CheckCircle, Download, X, Clock, AlertCircle, Loader2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import api from '../utils/api';
import { getApiError } from '../utils/helpers';
import ErrorAlert from '../components/ErrorAlert';

const MULTIPART_HEADERS = { 'Content-Type': 'multipart/form-data' };

const JOB_POLL_MS = 5000;
const JOBS_LIST_POLL_MS = 10000;

function statusBadge(status) {
  const map = {
    pending:   { bg: '#fff7ed', fg: '#9a3412', label: 'Pending' },
    parsing:   { bg: '#eff6ff', fg: '#1d4ed8', label: 'Parsing' },
    processed: { bg: '#ecfdf5', fg: '#047857', label: 'Processed' },
    failed:    { bg: '#fef2f2', fg: '#b91c1c', label: 'Failed' },
  };
  const s = map[status] || { bg: 'var(--bg)', fg: 'var(--text-2)', label: status };
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold"
      style={{ background: s.bg, color: s.fg }}>{s.label}</span>
  );
}

function fmtTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

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
  const [uploadMode, setUploadMode] = useState('excel');
  const [partsData, setPartsData]   = useState([]);
  const [partName, setPartName]     = useState('');
  const [partNumber, setPartNumber] = useState('');

  // PDF parse-jobs state
  const [pdfFile, setPdfFile]           = useState(null);
  const [pdfDragging, setPdfDragging]   = useState(false);
  const [pdfQueueing, setPdfQueueing]   = useState(false);
  const [pdfError, setPdfError]         = useState('');
  const [activeJob, setActiveJob]       = useState(null); // currently watched job
  const [recentJobs, setRecentJobs]     = useState([]);

  const fileRef = useRef();
  const pdfRef = useRef();

  useEffect(() => {
    Promise.all([api.get('/areas'), api.get('/parts')]).then(([a, p]) => {
      setAreas(a.data.data);
      setPartsData(p.data.data || []);
    });
  }, []);

  // Poll the active job until it leaves pending/parsing
  useEffect(() => {
    if (!activeJob || !['pending', 'parsing'].includes(activeJob.status)) return;
    const id = activeJob.job_id || activeJob.id;
    if (!id) return;
    const t = setInterval(async () => {
      try {
        const res = await api.get(`/voters/parse-jobs/${id}`);
        const data = res.data.data;
        setActiveJob(data);
        if (!['pending', 'parsing'].includes(data.status)) clearInterval(t);
      } catch {
        /* ignore — keep polling */
      }
    }, JOB_POLL_MS);
    return () => clearInterval(t);
  }, [activeJob]);

  // Refresh recent jobs while on PDF tab
  useEffect(() => {
    if (uploadMode !== 'pdf') return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await api.get('/voters/parse-jobs?limit=20');
        if (!cancelled) setRecentJobs(res.data.data?.jobs || []);
      } catch { /* ignore */ }
    };
    load();
    const t = setInterval(load, JOBS_LIST_POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [uploadMode, activeJob?.status]);

  const selectedPartEntry = partsData.find(p => p.part_name === partName);
  const partNumbers = selectedPartEntry ? selectedPartEntry.part_numbers : [];
  const showPartNumberDropdown = partNumbers.length > 1;

  const handlePartNameChange = (value) => {
    setPartName(value);
    setPartNumber('');
    if (value) {
      const entry = partsData.find(p => p.part_name === value);
      if (entry && entry.part_numbers.length === 1) {
        setPartNumber(String(entry.part_numbers[0]));
      }
    }
  };

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
    if (partNumber) formData.append('part_number', partNumber);
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

  // ── PDF parse-jobs handlers ─────────────────────────────────────────────
  const onPdfPicked = (f) => {
    if (!f) return;
    if (!/\.pdf$/i.test(f.name)) {
      setPdfError('Please pick a .pdf file');
      return;
    }
    setPdfFile(f); setPdfError('');
  };

  const handlePdfDrop = (e) => {
    e.preventDefault(); setPdfDragging(false);
    onPdfPicked(e.dataTransfer.files[0]);
  };

  const clearPdfFile = (e) => {
    e.stopPropagation();
    setPdfFile(null);
    if (pdfRef.current) pdfRef.current.value = '';
  };

  const queuePdf = async () => {
    if (!pdfFile) return;
    setPdfQueueing(true); setPdfError('');
    const fd = new FormData();
    fd.append('file', pdfFile);
    if (areaId) fd.append('area_id', areaId);
    if (partNumber) fd.append('part_number', partNumber);
    try {
      const res = await api.post('/voters/parse-jobs', fd, {
        headers: MULTIPART_HEADERS,
        timeout: 5 * 60 * 1000, // upload of 100MB PDF can be slow on flaky links
      });
      setActiveJob(res.data.data);
      setPdfFile(null);
      if (pdfRef.current) pdfRef.current.value = '';
      // Trigger an immediate jobs-list refresh
      try {
        const list = await api.get('/voters/parse-jobs?limit=20');
        setRecentJobs(list.data.data?.jobs || []);
      } catch { /* ignore */ }
    } catch (err) {
      setPdfError(getApiError(err, 'Failed to queue PDF'));
    } finally {
      setPdfQueueing(false);
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

  const activeIsRunning = activeJob && ['pending', 'parsing'].includes(activeJob.status);

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="page-header">
        <div className="anim-up">
          <h1 className="page-title">Upload Voter List</h1>
          <p className="page-subtitle">Import voter data from Excel, CSV, or PDF voter rolls</p>
        </div>
        {uploadMode === 'excel' && (
          <button onClick={downloadSample} className="btn-secondary text-sm anim-up anim-d1">
            <Download size={15} /> Download Sample
          </button>
        )}
      </div>

      {/* Upload Mode Tabs */}
      <div className="flex gap-2 anim-up">
        <button
          onClick={() => { setUploadMode('excel'); setPdfError(''); }}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
            uploadMode === 'excel' ? 'text-white' : ''
          }`}
          style={{
            background: uploadMode === 'excel' ? 'var(--text)' : 'var(--bg)',
            color: uploadMode === 'excel' ? 'white' : 'var(--text-2)',
            border: '1px solid var(--border)',
          }}
        >
          <FileSpreadsheet size={16} /> Excel / CSV
        </button>
        <button
          onClick={() => { setUploadMode('pdf'); setError(''); setResult(null); }}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all`}
          style={{
            background: uploadMode === 'pdf' ? 'var(--text)' : 'var(--bg)',
            color: uploadMode === 'pdf' ? 'white' : 'var(--text-2)',
            border: '1px solid var(--border)',
          }}
        >
          <FileText size={16} /> PDF Voter Roll (Hindi)
        </button>
      </div>

      {/* PDF Upload Mode */}
      {uploadMode === 'pdf' && (
        <>
          {/* Active job banner */}
          {activeJob && (
            <div className="card p-5 anim-scale" style={{
              borderLeft: `3px solid ${
                activeJob.status === 'processed' ? '#10b981' :
                activeJob.status === 'failed'    ? '#ef4444' : 'var(--text)'
              }`
            }}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    {activeIsRunning ? <Loader2 size={18} className="animate-spin" style={{ color: 'var(--text)' }} /> :
                      activeJob.status === 'processed' ? <CheckCircle size={18} style={{ color: '#10b981' }} /> :
                      <AlertCircle size={18} style={{ color: '#ef4444' }} />}
                    <h3 className="font-bold" style={{ color: 'var(--text)' }}>
                      {activeIsRunning ? 'Processing your file' :
                       activeJob.status === 'processed' ? 'Import complete' : 'Import failed'}
                    </h3>
                    {statusBadge(activeJob.status)}
                  </div>
                  <p className="text-sm" style={{ color: 'var(--text-2)' }}>
                    {activeJob.pdf_filename || 'PDF'} · job #{activeJob.job_id || activeJob.id}
                  </p>
                  {activeIsRunning && (
                    <p className="text-xs mt-2" style={{ color: 'var(--text-3)' }}>
                      You can leave this page — we'll keep parsing in the background. Refresh anytime to check status.
                    </p>
                  )}
                  {activeJob.status === 'processed' && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                      {[
                        { label: 'Cover Total',   value: activeJob.cover_total ?? '—' },
                        { label: 'Extracted',     value: activeJob.total_extracted ?? '—' },
                        { label: 'Inserted',      value: activeJob.total_inserted ?? '—' },
                        { label: 'Skipped (dup)', value: activeJob.total_skipped ?? '—' },
                      ].map(s => (
                        <div key={s.label} className="rounded-lg p-3" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
                          <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>{s.label}</div>
                          <div className="text-2xl font-bold mt-1" style={{ color: 'var(--text)' }}>{s.value}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {activeJob.status === 'failed' && activeJob.error_message && (
                    <pre className="mt-3 p-3 rounded text-xs whitespace-pre-wrap break-all"
                      style={{ background: '#fef2f2', color: '#7f1d1d', maxHeight: 180, overflow: 'auto' }}>
                      {activeJob.error_message}
                    </pre>
                  )}
                </div>
                <button onClick={() => setActiveJob(null)} className="opacity-50 hover:opacity-100" title="Dismiss">
                  <X size={16} />
                </button>
              </div>
            </div>
          )}

          {/* Village / Part picker */}
          <div className="card p-5 anim-up anim-d1">
            <h3 className="font-bold mb-3" style={{ color: 'var(--text)' }}>Assign Location</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Village / Part Name</label>
                <select className="input" value={partName} onChange={e => handlePartNameChange(e.target.value)}>
                  <option value="">— Select Village —</option>
                  {partsData.map(p => (
                    <option key={p.part_name} value={p.part_name}>
                      {p.part_name} ({p.count} {p.count > 1 ? 'parts' : 'part'})
                    </option>
                  ))}
                </select>
              </div>
              {showPartNumberDropdown && (
                <div>
                  <label className="label">Part Number</label>
                  <select className="input" value={partNumber} onChange={e => setPartNumber(e.target.value)}>
                    <option value="">— Select Part No. —</option>
                    {partNumbers.map(num => (
                      <option key={num} value={String(num)}>Part {num}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <p className="text-xs mt-3" style={{ color: 'var(--text-3)' }}>
              Optional — helps tag the imported voters with their polling part.
            </p>
          </div>

          {/* PDF dropzone */}
          <div className="card p-5 anim-up anim-d2">
            <div
              onDrop={handlePdfDrop}
              onDragOver={e => { e.preventDefault(); setPdfDragging(true); }}
              onDragLeave={() => setPdfDragging(false)}
              onClick={() => pdfRef.current?.click()}
              className="border-2 border-dashed rounded-xl cursor-pointer transition-all py-12 px-6 text-center"
              style={{
                borderColor: pdfDragging ? 'var(--text)' : 'var(--border)',
                background: pdfDragging ? 'var(--bg)' : 'transparent',
              }}
            >
              <input ref={pdfRef} type="file" accept="application/pdf,.pdf" className="hidden"
                onChange={e => onPdfPicked(e.target.files[0])} />
              {pdfFile ? (
                <div>
                  <FileText size={36} className="mx-auto mb-3" style={{ color: 'var(--text-2)' }} />
                  <p className="font-semibold" style={{ color: 'var(--text)' }}>{pdfFile.name}</p>
                  <p className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>
                    {(pdfFile.size / 1024 / 1024).toFixed(1)} MB · Click to change
                  </p>
                  <button type="button" onClick={clearPdfFile}
                    className="mt-3 inline-flex items-center gap-1 text-xs transition-opacity hover:opacity-60"
                    style={{ color: 'var(--text-3)' }}>
                    <X size={11} /> Remove file
                  </button>
                </div>
              ) : (
                <div>
                  <Upload size={36} className="mx-auto mb-3 opacity-20" style={{ color: 'var(--text)' }} />
                  <p className="font-semibold" style={{ color: 'var(--text-2)' }}>Drag & drop ECI voter-roll PDF</p>
                  <p className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>or click to browse · max 100 MB</p>
                </div>
              )}
            </div>

            <ErrorAlert message={pdfError} />

            {pdfFile && (
              <button onClick={queuePdf} disabled={pdfQueueing} className="btn-primary mt-4 w-full justify-center py-3">
                {pdfQueueing
                  ? <><Loader2 size={15} className="animate-spin" /> Uploading…</>
                  : <><Upload size={15} /> Queue for parsing</>}
              </button>
            )}

            <p className="text-xs mt-3" style={{ color: 'var(--text-3)' }}>
              Parsing runs in the background on our worker. A 30-page PDF takes about 3 minutes.
              You'll see progress here, and the voters appear in your list as soon as the job completes.
            </p>
          </div>

          {/* Recent jobs */}
          <div className="card overflow-hidden anim-up anim-d3">
            <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
              <h3 className="font-bold" style={{ color: 'var(--text)' }}>Recent jobs</h3>
            </div>
            {recentJobs.length === 0 ? (
              <div className="p-6 text-sm text-center" style={{ color: 'var(--text-3)' }}>
                No PDF imports yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Job</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>File</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Status</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Inserted</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Cover</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentJobs.map(j => (
                      <tr key={j.id}
                        onClick={() => setActiveJob(j)}
                        className="cursor-pointer transition-colors hover:bg-[#fafafa]"
                        style={{ borderBottom: '1px solid var(--border)' }}>
                        <td className="px-3 py-2 font-mono" style={{ color: 'var(--text-2)' }}>#{j.id}</td>
                        <td className="px-3 py-2 max-w-[260px] truncate" style={{ color: 'var(--text)' }}>{j.pdf_filename}</td>
                        <td className="px-3 py-2">{statusBadge(j.status)}</td>
                        <td className="px-3 py-2 text-right" style={{ color: 'var(--text-2)' }}>{j.total_inserted ?? '—'}</td>
                        <td className="px-3 py-2 text-right" style={{ color: 'var(--text-3)' }}>{j.cover_total ?? '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-3)' }}>
                          <Clock size={11} className="inline mr-1 opacity-50" />
                          {fmtTime(j.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Excel Upload Mode */}
      {uploadMode === 'excel' && <>

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

      {/* Village / Part / Area Selection */}
      <div className="card p-5 anim-up anim-d1">
        <h3 className="font-bold mb-3" style={{ color: 'var(--text)' }}>Assign Location</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Village (Part Name) */}
          <div>
            <label className="label">Village / Part Name</label>
            <select className="input" value={partName} onChange={e => handlePartNameChange(e.target.value)}>
              <option value="">— Select Village —</option>
              {partsData.map(p => (
                <option key={p.part_name} value={p.part_name}>
                  {p.part_name} ({p.count} {p.count > 1 ? 'parts' : 'part'})
                </option>
              ))}
            </select>
          </div>

          {/* Part Number - only when village has multiple parts */}
          {showPartNumberDropdown && (
            <div>
              <label className="label">Part Number</label>
              <select className="input" value={partNumber} onChange={e => setPartNumber(e.target.value)}>
                <option value="">— Select Part No. —</option>
                {partNumbers.map(num => (
                  <option key={num} value={String(num)}>Part {num}</option>
                ))}
              </select>
            </div>
          )}

        </div>
        <p className="text-xs mt-3" style={{ color: 'var(--text-3)' }}>
          Select a village to tag voters with their polling booth part number. Area is optional.
        </p>
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

      </>}
    </div>
  );
}
