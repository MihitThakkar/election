"""
Voter-roll PDF parsing service for Railway.

Endpoints (all require X-Worker-Token header):
  POST /jobs                — accept multipart PDF, queue it, return job_id
  GET  /jobs/{id}           — current status + stats
  GET  /jobs                — list (filterable by status, uploaded_by)
  GET  /healthz             — liveness probe (no auth)

A single asyncio task polls the parse_jobs table every few seconds, claims
the next pending row (SELECT … FOR UPDATE SKIP LOCKED), runs the heavy
parsing in a thread executor, and writes the result back to the same row.
One job at a time per worker process — Vision API + image rendering is
CPU/IO heavy and we don't want to compete for memory.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import sys
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import mysql.connector
from fastapi import FastAPI, File, Form, HTTPException, Header, UploadFile
from fastapi.responses import JSONResponse

# ── Resolve paths and import the parser ────────────────────────────────────
SERVICE_DIR = Path(__file__).resolve().parent
REPO_ROOT = SERVICE_DIR.parent
PARSER_DIR = REPO_ROOT / 'backend' / 'scripts'
if not PARSER_DIR.exists():
    raise RuntimeError(f'Parser scripts not found at {PARSER_DIR}')
sys.path.insert(0, str(PARSER_DIR))

# Bootstrap GCP credentials from env var BEFORE importing the parser.
# Railway can't ship a JSON file, so we drop it on disk and point ADC at it.
def _bootstrap_gcp_creds():
    raw = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS_JSON')
    if not raw:
        return
    creds_path = Path('/tmp/gcp-creds.json')
    creds_path.write_text(raw, encoding='utf-8')
    os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = str(creds_path)

_bootstrap_gcp_creds()

import vision_pdf_parser_4 as parser4  # noqa: E402

# ── Config ─────────────────────────────────────────────────────────────────
WORKER_TOKEN = os.environ.get('WORKER_TOKEN')
JOBS_DIR = Path(os.environ.get('JOBS_DIR', '/tmp/parse-jobs'))
OCR_CACHE_DIR = Path(os.environ.get('OCR_CACHE_DIR', '/tmp/ocr-cache'))
POLL_INTERVAL = float(os.environ.get('POLL_INTERVAL_SEC', '5'))
MAX_PDF_BYTES = int(os.environ.get('MAX_PDF_BYTES', str(150 * 1024 * 1024)))

JOBS_DIR.mkdir(parents=True, exist_ok=True)
OCR_CACHE_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
)
log = logging.getLogger('parser-service')

# ── DB helpers ─────────────────────────────────────────────────────────────
def get_conn():
    return parser4.get_db_connection()

def ensure_schema():
    conn = get_conn()
    try:
        parser4.migrate_db(conn)
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS parse_jobs (
              id INT AUTO_INCREMENT PRIMARY KEY,
              pdf_filename VARCHAR(500) NOT NULL,
              pdf_size_bytes BIGINT,
              uploaded_by INT,
              area_id INT,
              part_number INT,
              status ENUM('pending','parsing','processed','failed') NOT NULL DEFAULT 'pending',
              cover_total INT,
              total_extracted INT,
              total_inserted INT,
              total_skipped INT,
              error_message TEXT,
              pdf_path VARCHAR(500),
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              started_at DATETIME,
              completed_at DATETIME
            )
        """)
        for stmt in (
            "ALTER TABLE parse_jobs ADD COLUMN pdf_path VARCHAR(500)",
            "CREATE INDEX idx_parse_jobs_status ON parse_jobs(status)",
            "CREATE INDEX idx_parse_jobs_uploaded_by ON parse_jobs(uploaded_by)",
        ):
            try:
                cur.execute(stmt)
            except mysql.connector.Error:
                pass
        conn.commit()
        cur.close()
    finally:
        conn.close()

# ── Job processing (runs in thread executor) ───────────────────────────────
def _job_to_dict(row, columns):
    return {col: row[idx] for idx, col in enumerate(columns)}

JOB_COLUMNS = (
    'id', 'pdf_filename', 'pdf_size_bytes', 'uploaded_by', 'area_id',
    'part_number', 'status', 'cover_total', 'total_extracted',
    'total_inserted', 'total_skipped', 'error_message', 'pdf_path',
    'created_at', 'started_at', 'completed_at',
)
JOB_COLS_SQL = ', '.join(JOB_COLUMNS)

def claim_next_job() -> Optional[dict]:
    """Atomically claim one pending job. Returns the row or None."""
    conn = get_conn()
    try:
        conn.start_transaction()
        cur = conn.cursor()
        # SKIP LOCKED requires MySQL 8.0+. If the host is older, fall back.
        try:
            cur.execute(
                f"SELECT {JOB_COLS_SQL} FROM parse_jobs "
                "WHERE status = 'pending' ORDER BY id LIMIT 1 "
                "FOR UPDATE SKIP LOCKED"
            )
        except mysql.connector.Error:
            cur.execute(
                f"SELECT {JOB_COLS_SQL} FROM parse_jobs "
                "WHERE status = 'pending' ORDER BY id LIMIT 1 FOR UPDATE"
            )
        row = cur.fetchone()
        if not row:
            conn.commit()
            return None
        job = _job_to_dict(row, JOB_COLUMNS)
        cur.execute(
            "UPDATE parse_jobs SET status='parsing', started_at=NOW() "
            "WHERE id=%s",
            (job['id'],),
        )
        conn.commit()
        cur.close()
        return job
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def finish_job(job_id: int, *, status: str, error: str = None,
               cover_total: int = None, extracted: int = None,
               inserted: int = None, skipped: int = None):
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE parse_jobs SET status=%s, error_message=%s, "
            "cover_total=%s, total_extracted=%s, total_inserted=%s, "
            "total_skipped=%s, completed_at=NOW() WHERE id=%s",
            (status, error, cover_total, extracted, inserted, skipped, job_id),
        )
        conn.commit()
        cur.close()
    finally:
        conn.close()

def run_job_blocking(job: dict):
    """Synchronous heavy work: render PDF, run OCR, insert voters."""
    job_id = job['id']
    pdf_path = job['pdf_path']
    if not pdf_path or not Path(pdf_path).exists():
        finish_job(job_id, status='failed',
                   error=f'PDF file missing on disk: {pdf_path}')
        return

    log.info('job %s: starting parse of %s', job_id, job['pdf_filename'])
    t0 = time.time()
    try:
        ocr = parser4.VisionOCR(cache_dir=str(OCR_CACHE_DIR))
        result = parser4.process_pdf(pdf_path, ocr, verbose=False)
    except Exception as e:
        log.exception('job %s: parse failed', job_id)
        finish_job(job_id, status='failed',
                   error=f'parse error: {e}\n{traceback.format_exc()[:2000]}')
        _safe_unlink(pdf_path)
        return

    voters = result.get('voters', [])
    cover_total = (result.get('part_total') or {}).get('total')
    extracted = len(voters)

    # Stamp area_id + assignment fields on every voter so they show up under
    # the right area in the existing voter UI.
    if job.get('area_id'):
        for v in voters:
            v.setdefault('_area_id', job['area_id'])

    inserted = 0
    skipped = 0
    if voters:
        conn = get_conn()
        try:
            inserted, skipped = _insert_with_area(
                conn, voters, result['pdf_name'], job.get('area_id'),
            )
        except Exception as e:
            log.exception('job %s: insert failed', job_id)
            finish_job(job_id, status='failed',
                       error=f'insert error: {e}')
            conn.close()
            _safe_unlink(pdf_path)
            return
        finally:
            conn.close()

    elapsed = time.time() - t0
    log.info(
        'job %s: done in %.1fs — extracted=%s inserted=%s skipped=%s cover=%s',
        job_id, elapsed, extracted, inserted, skipped, cover_total,
    )
    finish_job(
        job_id, status='processed',
        cover_total=cover_total, extracted=extracted,
        inserted=inserted, skipped=skipped,
    )
    _safe_unlink(pdf_path)


def _insert_with_area(conn, voters, pdf_name, area_id):
    """Wrap parser4.insert_voters_batch but stamp area_id on each row."""
    if not area_id:
        return parser4.insert_voters_batch(conn, voters, pdf_name)

    # Insert via parser, then update area_id for the rows we just touched.
    # We use voter_id as the join key (UNIQUE).
    inserted, skipped = parser4.insert_voters_batch(conn, voters, pdf_name)
    voter_ids = [v.get('voter_id') for v in voters if v.get('voter_id')]
    if voter_ids:
        cur = conn.cursor()
        # Chunk to avoid huge IN clauses
        chunk_size = 500
        for i in range(0, len(voter_ids), chunk_size):
            chunk = voter_ids[i:i + chunk_size]
            placeholders = ','.join(['%s'] * len(chunk))
            cur.execute(
                f"UPDATE voters SET area_id=%s WHERE voter_id IN ({placeholders}) "
                "AND (area_id IS NULL OR area_id <> %s)",
                [area_id, *chunk, area_id],
            )
        conn.commit()
        cur.close()
    return inserted, skipped


def _safe_unlink(path):
    try:
        Path(path).unlink(missing_ok=True)
    except Exception:
        pass

# ── Worker loop ────────────────────────────────────────────────────────────
class Worker:
    def __init__(self):
        self._task: Optional[asyncio.Task] = None
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='parser')
        self._stop = asyncio.Event()

    async def start(self):
        self._task = asyncio.create_task(self._loop())
        log.info('worker loop started (poll=%ss)', POLL_INTERVAL)

    async def stop(self):
        self._stop.set()
        if self._task:
            await self._task
        self._executor.shutdown(wait=True)

    async def _loop(self):
        loop = asyncio.get_running_loop()
        while not self._stop.is_set():
            try:
                job = await loop.run_in_executor(self._executor, claim_next_job)
            except Exception:
                log.exception('claim_next_job failed')
                job = None

            if job is None:
                try:
                    await asyncio.wait_for(self._stop.wait(), timeout=POLL_INTERVAL)
                except asyncio.TimeoutError:
                    pass
                continue

            try:
                await loop.run_in_executor(self._executor, run_job_blocking, job)
            except Exception:
                log.exception('run_job_blocking crashed (job %s)', job.get('id'))
                try:
                    finish_job(job['id'], status='failed',
                               error='worker crashed; see service logs')
                except Exception:
                    log.exception('also failed to mark job failed')

worker = Worker()

# ── FastAPI app ────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        ensure_schema()
    except Exception:
        log.exception('ensure_schema failed (continuing — Vercel may have run migrations)')
    await worker.start()
    yield
    await worker.stop()

app = FastAPI(title='Voter PDF Parser', lifespan=lifespan)


def _check_token(token: Optional[str]):
    if not WORKER_TOKEN:
        raise HTTPException(500, 'WORKER_TOKEN not configured on server')
    if not token or token != WORKER_TOKEN:
        raise HTTPException(401, 'invalid worker token')


@app.get('/healthz')
def healthz():
    return {'ok': True}


@app.post('/jobs')
async def create_job(
    pdf: UploadFile = File(...),
    uploaded_by: Optional[int] = Form(None),
    area_id: Optional[int] = Form(None),
    part_number: Optional[int] = Form(None),
    x_worker_token: Optional[str] = Header(None, alias='X-Worker-Token'),
):
    _check_token(x_worker_token)

    if not pdf.filename or not pdf.filename.lower().endswith('.pdf'):
        raise HTTPException(400, 'expected a .pdf upload')

    # Save to disk under a unique name so concurrent uploads can't collide.
    safe_stem = Path(pdf.filename).stem.replace('/', '_').replace('\\', '_')
    unique = f'{int(time.time())}-{uuid.uuid4().hex[:8]}-{safe_stem}.pdf'
    dest = JOBS_DIR / unique

    size = 0
    with dest.open('wb') as fh:
        while True:
            chunk = await pdf.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_PDF_BYTES:
                fh.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(413, f'pdf exceeds {MAX_PDF_BYTES} bytes')
            fh.write(chunk)

    if size == 0:
        dest.unlink(missing_ok=True)
        raise HTTPException(400, 'empty upload')

    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO parse_jobs "
            "(pdf_filename, pdf_size_bytes, uploaded_by, area_id, part_number, "
            "status, pdf_path) "
            "VALUES (%s, %s, %s, %s, %s, 'pending', %s)",
            (pdf.filename, size, uploaded_by, area_id, part_number, str(dest)),
        )
        job_id = cur.lastrowid
        conn.commit()
        cur.close()
    except Exception as e:
        dest.unlink(missing_ok=True)
        raise HTTPException(500, f'failed to enqueue: {e}')
    finally:
        conn.close()

    log.info('job %s queued (%s, %d bytes)', job_id, pdf.filename, size)
    return JSONResponse({
        'job_id': job_id,
        'status': 'pending',
        'pdf_filename': pdf.filename,
        'pdf_size_bytes': size,
    })


@app.get('/jobs/{job_id}')
def get_job(
    job_id: int,
    x_worker_token: Optional[str] = Header(None, alias='X-Worker-Token'),
):
    _check_token(x_worker_token)
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            f"SELECT {JOB_COLS_SQL} FROM parse_jobs WHERE id=%s", (job_id,),
        )
        row = cur.fetchone()
        cur.close()
    finally:
        conn.close()
    if not row:
        raise HTTPException(404, 'job not found')
    job = _job_to_dict(row, JOB_COLUMNS)
    job.pop('pdf_path', None)
    for ts in ('created_at', 'started_at', 'completed_at'):
        if job.get(ts) is not None:
            job[ts] = job[ts].isoformat()
    return job


@app.get('/jobs')
def list_jobs(
    status: Optional[str] = None,
    uploaded_by: Optional[int] = None,
    limit: int = 50,
    x_worker_token: Optional[str] = Header(None, alias='X-Worker-Token'),
):
    _check_token(x_worker_token)
    limit = max(1, min(limit, 200))
    where = []
    params = []
    if status:
        where.append('status=%s')
        params.append(status)
    if uploaded_by is not None:
        where.append('uploaded_by=%s')
        params.append(uploaded_by)
    where_sql = ('WHERE ' + ' AND '.join(where)) if where else ''
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            f"SELECT {JOB_COLS_SQL} FROM parse_jobs {where_sql} "
            f"ORDER BY id DESC LIMIT %s",
            (*params, limit),
        )
        rows = cur.fetchall()
        cur.close()
    finally:
        conn.close()
    jobs = []
    for r in rows:
        j = _job_to_dict(r, JOB_COLUMNS)
        j.pop('pdf_path', None)
        for ts in ('created_at', 'started_at', 'completed_at'):
            if j.get(ts) is not None:
                j[ts] = j[ts].isoformat()
        jobs.append(j)
    return {'jobs': jobs}
