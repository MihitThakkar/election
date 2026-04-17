import { useState, useEffect, useRef } from 'react';
import { Video, Upload, Trash2, Play, X, Info } from 'lucide-react';
import api from '../utils/api';
import { getApiError } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';
import { PageSpinner } from '../components/Spinner';
import ErrorAlert from '../components/ErrorAlert';

const MULTIPART_HEADERS = { 'Content-Type': 'multipart/form-data' };

function VideoPlayerModal({ video, onClose }) {
  const videoSrc = `${window.location.origin}${video.file_path}`;
  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="rounded-2xl overflow-hidden w-full max-w-2xl" style={{ background: '#000', animation: 'scaleIn .22s ease' }}>
        <div className="flex items-center justify-between px-4 py-3" style={{ background: '#000' }}>
          <h3 className="text-white font-semibold text-sm truncate">{video.title}</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors ml-3"><X size={18} /></button>
        </div>
        <video src={videoSrc} controls autoPlay className="w-full max-h-[70vh]" style={{ background: '#000' }}
          onError={e => { e.target.parentElement.innerHTML = '<div class="p-8 text-center text-white/40 text-sm">Video could not be loaded.</div>'; }} />
        {video.description && (
          <div className="px-4 py-3 text-sm" style={{ background: '#111', color: '#aaa' }}>{video.description}</div>
        )}
      </div>
    </div>
  );
}

export default function VideoGuide() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'super_admin';

  const [videos, setVideos]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [playing, setPlaying]       = useState(null);
  const [form, setForm]             = useState({ title: '', description: '' });
  const [file, setFile]             = useState(null);
  const [uploading, setUploading]   = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError]           = useState('');
  const fileRef = useRef();

  const fetchVideos = async () => {
    const res = await api.get('/videos');
    setVideos(res.data.data); setLoading(false);
  };
  useEffect(() => { fetchVideos(); }, []);

  const handleUpload = async (e) => {
    e.preventDefault(); if (!file || !form.title) return;
    setUploading(true); setError(''); setUploadProgress(0);
    const formData = new FormData();
    formData.append('video', file);
    formData.append('title', form.title);
    formData.append('description', form.description);
    try {
      await api.post('/videos', formData, {
        headers: MULTIPART_HEADERS,
        onUploadProgress: e => setUploadProgress(Math.round((e.loaded*100)/e.total)),
      });
      setForm({ title:'', description:'' }); setFile(null); setShowUpload(false); setUploadProgress(0);
      await fetchVideos();
    } catch (err) { setError(getApiError(err, 'Upload failed')); }
    finally { setUploading(false); }
  };

  const handleDelete = async (id, title) => {
    if (!confirm(`Delete "${title}"?`)) return;
    await api.delete(`/videos/${id}`);
    setVideos(prev => prev.filter(v => v.id !== id));
  };

  if (loading) return <PageSpinner />;

  const STEPS = [
    "Go to the voter's home address",
    'Explain the video voting process',
    'Show this video guide if the voter needs help',
    'Ask voter to open the government voting app',
    'Voter records video: "Main [Candidate Name] ko vote deta/deti hu"',
    'Once done, mark voter as Done ✓ in your list',
  ];

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div className="anim-up">
          <h1 className="page-title">Video Guide</h1>
          <p className="page-subtitle">Voter instructions for the video voting process</p>
        </div>
        {isAdmin && (
          <button onClick={() => setShowUpload(!showUpload)} className="btn-primary anim-up anim-d1">
            <Upload size={15} /> Upload Video
          </button>
        )}
      </div>

      {/* Process guide */}
      <div className="card p-5 anim-up anim-d1" style={{ borderLeft: '3px solid var(--text)' }}>
        <div className="flex items-start gap-3">
          <Info size={17} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--text-2)' }} />
          <div>
            <h3 className="font-bold mb-3" style={{ color: 'var(--text)' }}>Process — How to Guide Voters</h3>
            <ol className="space-y-2">
              {STEPS.map((step, i) => (
                <li key={i} className="flex gap-2.5 text-sm" style={{ color: 'var(--text-2)' }}>
                  <span className="font-bold flex-shrink-0 w-4" style={{ color: 'var(--text)' }}>{i+1}.</span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      {/* Upload form */}
      {showUpload && isAdmin && (
        <div className="card p-5 anim-scale" style={{ border: '1.5px solid var(--border-strong)' }}>
          <h3 className="font-bold mb-4" style={{ color: 'var(--text)' }}>Upload New Video</h3>
          <ErrorAlert message={error} />
          <form onSubmit={handleUpload} className="space-y-4">
            <div>
              <label className="label">Video Title *</label>
              <input className="input" value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                required placeholder="e.g. How to vote on the government app" />
            </div>
            <div>
              <label className="label">Description</label>
              <textarea className="input resize-none" rows={2} value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Brief description" />
            </div>
            <div>
              <label className="label">Video File * (MP4, WebM, MOV — max 200 MB)</label>
              <div onClick={() => fileRef.current?.click()}
                className={`border-2 border-dashed rounded-xl cursor-pointer py-6 px-4 text-center transition-all duration-200
                  ${file ? 'border-black bg-[#f5f5f5]' : 'border-[var(--border)] hover:border-black hover:bg-[#f8f8f8]'}`}>
                <input ref={fileRef} type="file" accept="video/*" className="hidden"
                  onChange={e => setFile(e.target.files[0])} />
                {file ? (
                  <div>
                    <Video size={22} className="mx-auto mb-2" style={{ color: 'var(--text-2)' }} />
                    <p className="font-semibold text-sm" style={{ color: 'var(--text)' }}>{file.name}</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>{(file.size/(1024*1024)).toFixed(1)} MB</p>
                  </div>
                ) : (
                  <div>
                    <Upload size={22} className="mx-auto mb-2 opacity-30" style={{ color: 'var(--text)' }} />
                    <p className="text-sm" style={{ color: 'var(--text-2)' }}>Click to select video file</p>
                  </div>
                )}
              </div>
            </div>
            {uploading && uploadProgress > 0 && (
              <div>
                <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--text-3)' }}>
                  <span>Uploading...</span><span>{uploadProgress}%</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg)' }}>
                  <div className="h-full rounded-full progress-bar" style={{ width:`${uploadProgress}%`, background:'#0a0a0a' }} />
                </div>
              </div>
            )}
            <div className="flex gap-3">
              <button type="submit" disabled={!file || uploading} className="btn-primary flex-1 justify-center">
                {uploading ? `Uploading ${uploadProgress}%...` : <><Upload size={13} /> Upload Video</>}
              </button>
              <button type="button" onClick={() => { setShowUpload(false); setFile(null); setError(''); }} className="btn-secondary">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Videos grid */}
      {videos.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 anim-list">
          {videos.map(v => (
            <div key={v.id} className="card overflow-hidden group card-hover">
              <div onClick={() => setPlaying(v)}
                className="relative h-40 flex items-center justify-center cursor-pointer transition-all duration-200"
                style={{ background: '#0a0a0a' }}>
                <div className="w-14 h-14 rounded-full border-2 border-white/30 flex items-center justify-center
                               transition-all duration-200 group-hover:scale-110 group-hover:border-white/60"
                  style={{ background: 'rgba(255,255,255,.12)' }}>
                  <Play size={22} className="text-white ml-0.5" fill="white" />
                </div>
                <Video size={36} className="absolute opacity-[0.06] text-white" />
              </div>
              <div className="p-3">
                <h4 className="font-semibold text-sm truncate" style={{ color: 'var(--text)' }}>{v.title}</h4>
                {v.description && <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>{v.description}</p>}
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                    {v.uploaded_by_name} · {new Date(v.created_at).toLocaleDateString('en-IN')}
                  </span>
                  <div className="flex gap-0.5">
                    <button onClick={() => setPlaying(v)}
                      className="p-1.5 rounded transition-all hover:bg-black hover:text-white"
                      style={{ color: 'var(--text-3)' }}><Play size={13} /></button>
                    {isAdmin && (
                      <button onClick={() => handleDelete(v.id, v.title)}
                        className="p-1.5 rounded transition-all hover:bg-black hover:text-white"
                        style={{ color: 'var(--text-3)' }}><Trash2 size={13} /></button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card p-14 text-center anim-fade" style={{ color: 'var(--text-3)' }}>
          <Video size={36} className="mx-auto mb-3 opacity-20" />
          <p className="font-semibold">No guide videos yet</p>
          {isAdmin && <p className="text-sm mt-1">Upload a video demonstrating how voters should cast their vote</p>}
        </div>
      )}

      {playing && <VideoPlayerModal video={playing} onClose={() => setPlaying(null)} />}
    </div>
  );
}
