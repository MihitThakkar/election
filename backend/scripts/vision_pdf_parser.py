#!/usr/bin/env python3
"""
High-accuracy Indian Election Voter Roll PDF parser using Google Cloud Vision.
Extracts voter data from image-based Hindi PDFs and inserts directly into MySQL.

EPIC accuracy target: 97%+

Usage:
  # Single PDF → stdout JSON
  python3 vision_pdf_parser.py /path/to/voter-roll.pdf

  # Single PDF → CSV
  python3 vision_pdf_parser.py /path/to/voter-roll.pdf --format csv --out voters.csv

  # Single PDF → direct MySQL insert
  python3 vision_pdf_parser.py /path/to/voter-roll.pdf --db

  # Batch: entire directory of PDFs → MySQL
  python3 vision_pdf_parser.py /path/to/pdf_folder/ --db --batch

  # With constituency metadata parsed from filename
  python3 vision_pdf_parser.py /path/to/2026-EROLLGEN-S20-153-SIR-...-78-WI.pdf --db

Prerequisites:
  pip install -r requirements.txt
  export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
  export MYSQL_HOST=localhost MYSQL_USER=root MYSQL_PASSWORD=... MYSQL_DATABASE=election
"""

import sys
import os
import re
import json
import csv
import io
import argparse
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter
from pdf2image import convert_from_path

# Google Cloud Vision
from google.cloud import vision

# MySQL
import mysql.connector

# ---------------------------------------------------------------------------
# EPIC Validation Patterns
# ---------------------------------------------------------------------------

EPIC_PATTERNS = [
    # Standard 3-letter prefix + 7 digits: XNN1339407, HGX2609584, SNE0847301
    re.compile(r'^[A-Z]{3}\d{7}$'),
    # 3-letter prefix + 6 digits: WFX090788, FHR287598
    re.compile(r'^[A-Z]{3}\d{6}$'),
    # State format: RJ/18/142/120284, FU/18/142/120803
    re.compile(r'^[A-Z]{2}/\d{2}/\d{2,3}/\d{5,8}$'),
]

# Known valid EPIC prefixes (Indian states/UTs)
KNOWN_PREFIXES = {
    'XNN', 'HGX', 'WFX', 'FHR', 'SNE', 'NNN', 'GDN', 'YPL', 'UTC', 'UKD',
    'RDL', 'BJH', 'MZP', 'LWE', 'JBP', 'BPL', 'NDL', 'DLH', 'MUM', 'PUN',
    'CHD', 'GJR', 'KRL', 'TNR', 'APR', 'KAR', 'MHR', 'WBG', 'ASM', 'BHR',
    'JHR', 'ORS', 'HPR', 'JKR', 'UPR', 'MPR', 'CGR', 'RJR', 'HRR', 'TEL',
    # Add more as discovered
}

# Common OCR misreads for EPIC characters
EPIC_CHAR_FIXES = {
    'O': '0', 'o': '0', 'I': '1', 'l': '1', 'S': '5', 'B': '8',
    'D': '0', 'Z': '2', 'G': '6', 'q': '9', '|': '1',
}

# Common OCR misreads for EPIC prefix letters (digit→letter in prefix)
EPIC_PREFIX_FIXES = {
    '0': 'O', '1': 'I', '5': 'S', '8': 'B', '6': 'G', '2': 'Z',
}


def validate_epic(raw: str) -> tuple:
    """
    Validate and clean EPIC number. Returns (cleaned_epic, confidence, issues).
    confidence: 1.0 = perfect match, 0.9 = fixed via rules, 0.0 = invalid
    """
    if not raw:
        return None, 0.0, ['empty']

    epic = raw.strip().replace(' ', '').replace('\n', '').replace('|', '/')

    # Remove any surrounding noise characters
    epic = re.sub(r'[^A-Za-z0-9/]', '', epic)
    epic = epic.upper()

    # Check perfect match first
    for pat in EPIC_PATTERNS:
        if pat.match(epic):
            return epic, 1.0, []

    issues = []

    # Try fixing common OCR errors in digit section
    # Split into prefix (letters) and suffix (digits) for standard format
    prefix_match = re.match(r'^([A-Z]{2,3})(\d{6,7})$', epic)
    if prefix_match:
        prefix, digits = prefix_match.groups()
        return epic, 1.0, []

    # Try to fix mixed-up characters
    # e.g., XNN1339O07 → XNN1339007
    if len(epic) == 10 and epic[:3].isalpha():
        prefix = epic[:3]
        digit_part = epic[3:]
        fixed_digits = ''
        for ch in digit_part:
            if ch.isdigit():
                fixed_digits += ch
            elif ch in EPIC_CHAR_FIXES:
                fixed_digits += EPIC_CHAR_FIXES[ch]
                issues.append(f'fixed {ch}→{EPIC_CHAR_FIXES[ch]}')
            else:
                fixed_digits += ch
        if fixed_digits.isdigit() and len(fixed_digits) == 7:
            return prefix + fixed_digits, 0.95, issues

    # Same for 9-char EPICs (3 letters + 6 digits)
    if len(epic) == 9 and epic[:3].isalpha():
        prefix = epic[:3]
        digit_part = epic[3:]
        fixed_digits = ''
        for ch in digit_part:
            if ch.isdigit():
                fixed_digits += ch
            elif ch in EPIC_CHAR_FIXES:
                fixed_digits += EPIC_CHAR_FIXES[ch]
                issues.append(f'fixed {ch}→{EPIC_CHAR_FIXES[ch]}')
            else:
                fixed_digits += ch
        if fixed_digits.isdigit() and len(fixed_digits) == 6:
            return prefix + fixed_digits, 0.95, issues

    # Fix prefix: digit in prefix position
    if len(epic) >= 9:
        fixed_prefix = ''
        for i, ch in enumerate(epic[:3]):
            if ch.isalpha():
                fixed_prefix += ch
            elif ch in EPIC_PREFIX_FIXES:
                fixed_prefix += EPIC_PREFIX_FIXES[ch]
                issues.append(f'prefix fix {ch}→{EPIC_PREFIX_FIXES[ch]}')
            else:
                fixed_prefix += ch
        rest = epic[3:]
        candidate = fixed_prefix + rest
        for pat in EPIC_PATTERNS:
            if pat.match(candidate):
                return candidate, 0.90, issues

    # State format: RJ/18/142/120284
    slash_match = re.match(r'^([A-Z]{2})/(\d{2})/(\d{2,3})/(\d{5,8})$', epic)
    if slash_match:
        return epic, 1.0, []

    # Try to reconstruct state format from digits with missing slashes
    # e.g., RJ18142120284 → RJ/18/142/120284
    state_match = re.match(r'^([A-Z]{2})(\d{2})(\d{2,3})(\d{5,8})$', epic)
    if state_match:
        reconstructed = f'{state_match.group(1)}/{state_match.group(2)}/{state_match.group(3)}/{state_match.group(4)}'
        issues.append('reconstructed slashes')
        return reconstructed, 0.90, issues

    # FU/FJ format
    fu_match = re.match(r'^(FU|FJ)/(\d{2})/(\d{2,3})/(\d{5,8})$', epic)
    if fu_match:
        return epic, 1.0, []

    # Last resort: return raw with low confidence
    return epic, 0.5, ['no pattern match']


# ---------------------------------------------------------------------------
# Image Pre-processing
# ---------------------------------------------------------------------------

def preprocess_image(image: Image.Image) -> Image.Image:
    """Enhance image for better OCR accuracy."""
    # Convert to grayscale
    gray = image.convert('L')
    # Increase contrast
    enhancer = ImageEnhance.Contrast(gray)
    gray = enhancer.enhance(1.5)
    # Sharpen
    gray = gray.filter(ImageFilter.SHARPEN)
    # Binarize with adaptive threshold
    arr = np.array(gray)
    threshold = np.mean(arr) * 0.85
    binary = ((arr > threshold) * 255).astype(np.uint8)
    return Image.fromarray(binary).convert('RGB')


def preprocess_cell(cell_image: Image.Image) -> Image.Image:
    """Pre-process an individual voter card cell for OCR."""
    # Scale up 3x for better small text recognition
    w, h = cell_image.size
    cell_image = cell_image.resize((w * 3, h * 3), Image.LANCZOS)
    # Enhance
    gray = cell_image.convert('L')
    enhancer = ImageEnhance.Contrast(gray)
    gray = enhancer.enhance(2.0)
    enhancer = ImageEnhance.Sharpness(gray)
    gray = enhancer.enhance(2.0)
    # Binarize
    arr = np.array(gray)
    threshold = np.mean(arr) * 0.80
    binary = ((arr > threshold) * 255).astype(np.uint8)
    return Image.fromarray(binary).convert('RGB')


# ---------------------------------------------------------------------------
# Grid Detection (improved with OpenCV)
# ---------------------------------------------------------------------------

def detect_grid_cells(image: Image.Image) -> list:
    """Detect voter card grid cells using line detection."""
    arr = np.array(image.convert('L'))
    h, w = arr.shape

    # Find horizontal grid lines (rows where >40% pixels are dark)
    row_dark = (arr < 128).mean(axis=1)
    grid_rows = np.where(row_dark > 0.35)[0]

    if len(grid_rows) < 4:
        return []

    # Cluster consecutive dark rows into line positions
    breaks = np.where(np.diff(grid_rows) > 3)[0]
    h_lines = []
    start = grid_rows[0]
    for b in breaks:
        end = grid_rows[b]
        h_lines.append((start + end) // 2)
        start = grid_rows[b + 1]
    h_lines.append((start + grid_rows[-1]) // 2)

    # Find vertical grid lines
    col_dark = (arr < 128).mean(axis=0)
    grid_cols = np.where(col_dark > 0.35)[0]

    if len(grid_cols) < 4:
        return []

    breaks = np.where(np.diff(grid_cols) > 3)[0]
    v_lines = []
    start = grid_cols[0]
    for b in breaks:
        end = grid_cols[b]
        v_lines.append((start + end) // 2)
        start = grid_cols[b + 1]
    v_lines.append((start + grid_cols[-1]) // 2)

    # Build row pairs
    rows = []
    for i in range(0, len(h_lines) - 1, 2):
        row_h = h_lines[i + 1] - h_lines[i]
        if row_h > 50:  # minimum row height
            rows.append((h_lines[i], h_lines[i + 1]))

    # Build 3 columns
    left_edge = v_lines[0]
    right_edge = v_lines[-1]
    total_w = right_edge - left_edge

    separators = []
    for i in range(1, len(v_lines)):
        gap = v_lines[i] - v_lines[i - 1]
        pos = (v_lines[i - 1] + v_lines[i]) // 2
        if 10 < gap < 50 and pos > left_edge + total_w * 0.2 and pos < right_edge - total_w * 0.2:
            separators.append(pos)

    if len(separators) >= 2:
        target1 = left_edge + total_w / 3
        target2 = left_edge + 2 * total_w / 3
        sep1 = min(separators, key=lambda s: abs(s - target1))
        sep2 = min(separators, key=lambda s: abs(s - target2))
        cols = [(left_edge, sep1), (sep1, sep2), (sep2, right_edge)]
    else:
        col_w = total_w // 3
        cols = [
            (left_edge, left_edge + col_w),
            (left_edge + col_w, left_edge + 2 * col_w),
            (left_edge + 2 * col_w, right_edge),
        ]

    # Build cell bounding boxes
    cells = []
    for row_top, row_bottom in rows:
        for col_left, col_right in cols:
            pad = 5
            cell = (col_left + pad, row_top + pad, col_right - pad, row_bottom - pad)
            # Only include cells of reasonable size
            cw = cell[2] - cell[0]
            ch = cell[3] - cell[1]
            if cw > 80 and ch > 50:
                cells.append(cell)

    return cells


# ---------------------------------------------------------------------------
# Google Cloud Vision OCR
# ---------------------------------------------------------------------------

class VisionOCR:
    def __init__(self):
        self.client = vision.ImageAnnotatorClient()
        self._call_count = 0

    def ocr_image(self, pil_image: Image.Image) -> str:
        """OCR a PIL image using Google Cloud Vision with Hindi language hint."""
        buf = io.BytesIO()
        pil_image.save(buf, format='PNG')
        content = buf.getvalue()

        image = vision.Image(content=content)
        image_context = vision.ImageContext(
            language_hints=['hi', 'en']
        )

        response = self.client.text_detection(
            image=image,
            image_context=image_context
        )

        self._call_count += 1

        if response.error.message:
            raise Exception(f'Vision API error: {response.error.message}')

        if not response.text_annotations:
            return ''

        return response.text_annotations[0].description

    @property
    def call_count(self):
        return self._call_count


# ---------------------------------------------------------------------------
# Voter Card Text Parser
# ---------------------------------------------------------------------------

def parse_voter_text(text: str) -> dict:
    """Parse OCR text from a single voter card cell into structured data."""
    if not text or len(text.strip()) < 10:
        return None

    # Must contain voter-related keywords
    has_voter_keyword = any(kw in text for kw in ['निर्वाचक', 'नाम', 'Name'])
    if not has_voter_keyword:
        return None

    voter = {}

    # --- Serial Number ---
    # Usually appears as a standalone number at the top or in a box
    sr_match = re.search(r'(?:^|\n)\s*(\d{1,4})\s*(?:\n|$)', text)
    if sr_match:
        sr = int(sr_match.group(1))
        if 1 <= sr <= 9999:
            voter['sr_no'] = sr

    # --- EPIC / Voter ID ---
    # Look for alphanumeric codes: XNN1339407, RJ/18/142/120284, etc.
    epic_candidates = []

    # Standard format: 3 uppercase + 6-7 digits
    for m in re.finditer(r'[A-Z]{2,4}[O0-9]{5,8}', text):
        epic_candidates.append(m.group())

    # State format with slashes
    for m in re.finditer(r'[A-Z]{2}[/]\d{2}[/]\d{2,3}[/]\d{4,8}', text):
        epic_candidates.append(m.group())

    # FJ/FU format
    for m in re.finditer(r'(?:FJ|FU|RJ)[/]\d{2}[/]\d{2,3}[/]\d{4,8}', text):
        epic_candidates.append(m.group())

    # Pick the best EPIC
    best_epic = None
    best_conf = 0.0
    best_issues = []
    for raw in epic_candidates:
        cleaned, conf, issues = validate_epic(raw)
        if cleaned and conf > best_conf:
            best_epic = cleaned
            best_conf = conf
            best_issues = issues

    if best_epic:
        voter['voter_id'] = best_epic
        voter['epic_confidence'] = best_conf
        voter['epic_issues'] = best_issues

    # --- Voter Name ---
    name_match = re.search(
        r'(?:निर्वाचक\s*का\s*)?नाम\s*[:：]\s*:?\s*(.+?)(?:\n|पिता|पति|$)',
        text, re.MULTILINE
    )
    if name_match:
        name = name_match.group(1).strip()
        name = re.sub(r'[\s:：]+$', '', name)
        if name and len(name) >= 2:
            voter['name'] = name

    # --- Father/Husband Name ---
    father_match = re.search(
        r'(पिता|पति)\s*का\s*नाम\s*[:：]?\s*(.+?)(?:\n|गृह|उम्र|लिंग|फोटो|$)',
        text, re.MULTILINE
    )
    if father_match:
        voter['relation_type'] = 'father' if 'पिता' in father_match.group(1) else 'husband'
        fname = father_match.group(2).strip()
        fname = re.sub(r'[\s:：]+$', '', fname)
        if fname and len(fname) >= 2:
            voter['father_name'] = fname

    # --- House Number ---
    house_match = re.search(r'गृह\s*संख्या\s*[:：]?\s*(.+?)(?:\n|उम्र|लिंग|$)', text, re.MULTILINE)
    if house_match:
        hno = house_match.group(1).strip()
        hno = re.sub(r'[\s:：]+$', '', hno)
        if hno:
            voter['house_no'] = hno

    # --- Age ---
    age_match = re.search(r'(?:उम्र|उम्|आयु)\s*[:：]?\s*(\d{1,3})', text)
    if age_match:
        age = int(age_match.group(1))
        if 18 <= age <= 120:
            voter['age'] = age

    # --- Gender ---
    if re.search(r'महिला', text):
        voter['gender'] = 'F'
    elif re.search(r'पुरुष', text):
        voter['gender'] = 'M'

    # Must have at least name or EPIC to be valid
    if 'name' not in voter and 'voter_id' not in voter:
        return None

    # Set defaults
    voter.setdefault('voter_id', None)
    voter.setdefault('name', None)
    voter.setdefault('father_name', None)
    voter.setdefault('relation_type', None)
    voter.setdefault('age', None)
    voter.setdefault('gender', None)
    voter.setdefault('house_no', None)
    voter.setdefault('sr_no', None)
    voter.setdefault('epic_confidence', 0.0)
    voter.setdefault('epic_issues', [])

    return voter


# ---------------------------------------------------------------------------
# PDF Metadata Extraction (from filename)
# ---------------------------------------------------------------------------

def parse_pdf_filename(filepath: str) -> dict:
    """Extract constituency metadata from standard ECI PDF filename.

    Filename format: 2026-EROLLGEN-S20-153-SIR-DraftRoll-Revision1-HIN-78-WI.pdf
                     year-type-state-constituency-...-part-WI.pdf
    Supplement:      2026-SUPPLEMENTGEN-S20-155-2-all_together-HIN-1-WI.pdf
    """
    meta = {
        'year': None,
        'state_code': None,
        'constituency_no': None,
        'part_no': None,
        'roll_type': None,  # EROLLGEN or SUPPLEMENTGEN
    }

    name = Path(filepath).stem

    # Year
    year_match = re.search(r'^(\d{4})', name)
    if year_match:
        meta['year'] = int(year_match.group(1))

    # Roll type
    if 'EROLLGEN' in name:
        meta['roll_type'] = 'EROLL'
    elif 'SUPPLEMENTGEN' in name:
        meta['roll_type'] = 'SUPPLEMENT'

    # State code: S20 = Rajasthan, S01 = Andhra Pradesh, etc.
    state_match = re.search(r'S(\d{1,2})', name)
    if state_match:
        meta['state_code'] = f'S{state_match.group(1)}'

    # Constituency number
    parts = name.split('-')
    for i, p in enumerate(parts):
        if p.startswith('S') and p[1:].isdigit() and i + 1 < len(parts):
            try:
                meta['constituency_no'] = int(parts[i + 1])
            except ValueError:
                pass
            break

    # Part number — typically second-to-last numeric segment before WI
    # e.g., HIN-78-WI → part_no = 78
    wi_match = re.search(r'-(\d+)-WI', name)
    if wi_match:
        meta['part_no'] = int(wi_match.group(1))

    return meta


# ---------------------------------------------------------------------------
# MySQL Database Operations
# ---------------------------------------------------------------------------

# Extended voters table schema for all-India data
MIGRATION_SQL = """
ALTER TABLE voters
  ADD COLUMN IF NOT EXISTS state_code VARCHAR(10) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS constituency_no INT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS constituency_name VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS part_no INT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sr_no INT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS house_no VARCHAR(100) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS relation_type ENUM('father', 'husband') DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS epic_confidence FLOAT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS roll_type VARCHAR(20) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS roll_year INT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS source_pdf VARCHAR(500) DEFAULT NULL;
"""

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS voters (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255),
  age INT,
  voter_id VARCHAR(50),
  father_name VARCHAR(255),
  phone VARCHAR(20),
  address TEXT,
  gender ENUM('M', 'F'),
  area_id INT,
  assigned_to INT,
  status ENUM('pending', 'done', 'refused') DEFAULT 'pending',
  marked_by INT,
  marked_at DATETIME,
  state_code VARCHAR(10),
  constituency_no INT,
  constituency_name VARCHAR(255),
  part_no INT,
  sr_no INT,
  house_no VARCHAR(100),
  relation_type ENUM('father', 'husband'),
  epic_confidence FLOAT,
  roll_type VARCHAR(20),
  roll_year INT,
  source_pdf VARCHAR(500),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY idx_voter_id (voter_id),
  INDEX idx_state (state_code),
  INDEX idx_constituency (constituency_no),
  INDEX idx_part (part_no),
  INDEX idx_epic_conf (epic_confidence)
);
"""

INDEX_SQL = [
    "CREATE INDEX IF NOT EXISTS idx_voters_state_const ON voters(state_code, constituency_no)",
    "CREATE INDEX IF NOT EXISTS idx_voters_part ON voters(part_no)",
    "CREATE INDEX IF NOT EXISTS idx_voters_epic_conf ON voters(epic_confidence)",
]


def get_db_connection():
    """Get MySQL connection from environment variables."""
    if os.environ.get('MYSQL_URL'):
        from urllib.parse import urlparse
        url = urlparse(os.environ['MYSQL_URL'])
        return mysql.connector.connect(
            host=url.hostname,
            port=url.port or 3306,
            user=url.username,
            password=url.password,
            database=url.path.lstrip('/'),
        )

    return mysql.connector.connect(
        host=os.environ.get('MYSQL_HOST', 'localhost'),
        user=os.environ.get('MYSQL_USER', 'root'),
        password=os.environ.get('MYSQL_PASSWORD', ''),
        database=os.environ.get('MYSQL_DATABASE', 'election'),
        port=int(os.environ.get('MYSQL_PORT', 3306)),
    )


def migrate_db(conn):
    """Run database migrations to add new columns."""
    cursor = conn.cursor()

    # Try ALTER TABLE to add columns (ignore errors for existing columns)
    alter_columns = [
        ("state_code", "VARCHAR(10) DEFAULT NULL"),
        ("constituency_no", "INT DEFAULT NULL"),
        ("constituency_name", "VARCHAR(255) DEFAULT NULL"),
        ("part_no", "INT DEFAULT NULL"),
        ("sr_no", "INT DEFAULT NULL"),
        ("house_no", "VARCHAR(100) DEFAULT NULL"),
        ("relation_type", "VARCHAR(10) DEFAULT NULL"),
        ("epic_confidence", "FLOAT DEFAULT NULL"),
        ("roll_type", "VARCHAR(20) DEFAULT NULL"),
        ("roll_year", "INT DEFAULT NULL"),
        ("source_pdf", "VARCHAR(500) DEFAULT NULL"),
    ]

    for col_name, col_def in alter_columns:
        try:
            cursor.execute(f"ALTER TABLE voters ADD COLUMN {col_name} {col_def}")
            print(f"  Added column: {col_name}", file=sys.stderr)
        except mysql.connector.errors.ProgrammingError:
            pass  # Column already exists

    # Add indexes
    for sql in INDEX_SQL:
        try:
            cursor.execute(sql)
        except mysql.connector.errors.ProgrammingError:
            pass

    conn.commit()
    cursor.close()
    print("Database migration complete.", file=sys.stderr)


def insert_voters_batch(conn, voters: list, meta: dict, source_pdf: str):
    """Batch insert voters into MySQL with upsert on voter_id."""
    cursor = conn.cursor()

    sql = """
    INSERT INTO voters
      (name, age, voter_id, father_name, gender, address,
       state_code, constituency_no, part_no, sr_no, house_no,
       relation_type, epic_confidence, roll_type, roll_year, source_pdf)
    VALUES
      (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    ON DUPLICATE KEY UPDATE
      name = VALUES(name),
      age = VALUES(age),
      father_name = VALUES(father_name),
      gender = VALUES(gender),
      state_code = VALUES(state_code),
      constituency_no = VALUES(constituency_no),
      part_no = VALUES(part_no),
      sr_no = VALUES(sr_no),
      house_no = VALUES(house_no),
      relation_type = VALUES(relation_type),
      epic_confidence = VALUES(epic_confidence),
      roll_type = VALUES(roll_type),
      roll_year = VALUES(roll_year),
      source_pdf = VALUES(source_pdf)
    """

    batch = []
    skipped = 0
    for v in voters:
        # Skip voters without EPIC (can't upsert without unique key)
        if not v.get('voter_id'):
            skipped += 1
            continue

        address = f"House {v.get('house_no', '')}" if v.get('house_no') else None

        batch.append((
            v.get('name'),
            v.get('age'),
            v.get('voter_id'),
            v.get('father_name'),
            v.get('gender'),
            address,
            meta.get('state_code'),
            meta.get('constituency_no'),
            meta.get('part_no'),
            v.get('sr_no'),
            v.get('house_no'),
            v.get('relation_type'),
            v.get('epic_confidence'),
            meta.get('roll_type'),
            meta.get('year'),
            source_pdf,
        ))

    if batch:
        cursor.executemany(sql, batch)
        conn.commit()

    cursor.close()

    return len(batch), skipped


# ---------------------------------------------------------------------------
# Main Processing Pipeline
# ---------------------------------------------------------------------------

def process_pdf(pdf_path: str, ocr: VisionOCR, skip_pages: set = None,
                dpi: int = 300, verbose: bool = True) -> list:
    """Process a single PDF and return list of voter records."""
    if skip_pages is None:
        skip_pages = {1, 2}  # Header/info pages

    pdf_name = Path(pdf_path).name
    meta = parse_pdf_filename(pdf_path)

    if verbose:
        print(f"\n{'='*60}", file=sys.stderr)
        print(f"Processing: {pdf_name}", file=sys.stderr)
        print(f"Metadata: {json.dumps(meta, default=str)}", file=sys.stderr)
        print(f"Converting PDF to images at {dpi} DPI...", file=sys.stderr)

    images = convert_from_path(pdf_path, dpi=dpi)
    total_pages = len(images)

    if verbose:
        print(f"Total pages: {total_pages}", file=sys.stderr)

    all_voters = []
    global_sr = 0

    for page_num, image in enumerate(images, 1):
        if page_num in skip_pages:
            if verbose:
                print(f"  Page {page_num}/{total_pages}: skipped (header/info)", file=sys.stderr)
            continue

        # Check if this is the last summary page
        if page_num == total_pages:
            if verbose:
                print(f"  Page {page_num}/{total_pages}: skipped (summary)", file=sys.stderr)
            continue

        if verbose:
            print(f"  Page {page_num}/{total_pages}: ", file=sys.stderr, end='', flush=True)

        # Detect grid cells
        cells = detect_grid_cells(image)
        if not cells:
            if verbose:
                print("no grid detected, skipping", file=sys.stderr)
            continue

        if verbose:
            print(f"{len(cells)} cells → ", file=sys.stderr, end='', flush=True)

        page_voters = []
        for bbox in cells:
            # Crop cell
            cell_image = image.crop(bbox)
            if cell_image.width < 50 or cell_image.height < 30:
                continue

            # Pre-process for better OCR
            processed = preprocess_cell(cell_image)

            # OCR with Google Vision
            text = ocr.ocr_image(processed)

            # Parse structured data
            voter = parse_voter_text(text)
            if voter:
                global_sr += 1
                if not voter.get('sr_no'):
                    voter['sr_no'] = global_sr

                # Attach metadata
                voter['state_code'] = meta.get('state_code')
                voter['constituency_no'] = meta.get('constituency_no')
                voter['part_no'] = meta.get('part_no')

                page_voters.append(voter)

        all_voters.extend(page_voters)
        if verbose:
            epic_count = sum(1 for v in page_voters if v.get('voter_id'))
            print(f"{len(page_voters)} voters ({epic_count} with EPIC)", file=sys.stderr)

    return all_voters


def process_directory(dir_path: str, ocr: VisionOCR, **kwargs) -> list:
    """Process all PDFs in a directory."""
    pdf_files = sorted(Path(dir_path).glob('*.pdf'))
    if not pdf_files:
        print(f"No PDF files found in {dir_path}", file=sys.stderr)
        return []

    print(f"\nFound {len(pdf_files)} PDF files to process", file=sys.stderr)

    all_voters = []
    for i, pdf_path in enumerate(pdf_files, 1):
        print(f"\n[{i}/{len(pdf_files)}] ", file=sys.stderr, end='')
        voters = process_pdf(str(pdf_path), ocr, **kwargs)
        all_voters.extend(voters)

    return all_voters


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

def print_stats(voters: list):
    """Print extraction statistics."""
    total = len(voters)
    if total == 0:
        print("\nNo voters extracted.", file=sys.stderr)
        return

    stats = {
        'voter_id (EPIC)': sum(1 for v in voters if v.get('voter_id')),
        'name': sum(1 for v in voters if v.get('name')),
        'father_name': sum(1 for v in voters if v.get('father_name')),
        'age': sum(1 for v in voters if v.get('age')),
        'gender': sum(1 for v in voters if v.get('gender')),
        'house_no': sum(1 for v in voters if v.get('house_no')),
    }

    print(f"\n{'='*60}", file=sys.stderr)
    print(f"EXTRACTION SUMMARY", file=sys.stderr)
    print(f"{'='*60}", file=sys.stderr)
    print(f"Total voters: {total}", file=sys.stderr)
    for field, count in stats.items():
        pct = count * 100 / total
        bar = '█' * int(pct / 2) + '░' * (50 - int(pct / 2))
        status = '✓' if pct >= 97 else '⚠' if pct >= 90 else '✗'
        print(f"  {status} {field:20s}: {count:5d}/{total} ({pct:5.1f}%) {bar}", file=sys.stderr)

    # EPIC confidence breakdown
    epic_voters = [v for v in voters if v.get('voter_id')]
    if epic_voters:
        confs = [v.get('epic_confidence', 0) for v in epic_voters]
        perfect = sum(1 for c in confs if c >= 1.0)
        high = sum(1 for c in confs if 0.9 <= c < 1.0)
        low = sum(1 for c in confs if c < 0.9)
        print(f"\n  EPIC Confidence:", file=sys.stderr)
        print(f"    Perfect (100%): {perfect}/{len(epic_voters)}", file=sys.stderr)
        print(f"    High (90-99%):  {high}/{len(epic_voters)}", file=sys.stderr)
        print(f"    Low (<90%):     {low}/{len(epic_voters)} ← needs review", file=sys.stderr)

    print(f"\n  Vision API calls: {ocr.call_count if 'ocr' in dir() else 'N/A'}", file=sys.stderr)


# ---------------------------------------------------------------------------
# Output Formatters
# ---------------------------------------------------------------------------

FIELDS = ['sr_no', 'name', 'father_name', 'relation_type', 'age', 'gender',
          'voter_id', 'epic_confidence', 'house_no',
          'state_code', 'constituency_no', 'part_no']


def output_json(voters: list) -> str:
    """Format voters as JSON."""
    # Remove internal fields
    clean = []
    for v in voters:
        cv = {k: v.get(k) for k in FIELDS}
        cv['epic_issues'] = v.get('epic_issues', [])
        clean.append(cv)
    return json.dumps(clean, ensure_ascii=False, indent=2)


def output_csv(voters: list) -> str:
    """Format voters as CSV."""
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=FIELDS, extrasaction='ignore')
    writer.writeheader()
    for v in voters:
        row = {k: v.get(k, '') for k in FIELDS}
        writer.writerow(row)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description='Parse Indian Election Voter Roll PDFs using Google Cloud Vision',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Single PDF to JSON
  python3 vision_pdf_parser.py roll.pdf

  # Batch directory to MySQL
  python3 vision_pdf_parser.py ./pdfs/ --batch --db

  # Single PDF to CSV file
  python3 vision_pdf_parser.py roll.pdf --format csv --out voters.csv

  # Custom skip pages and DPI
  python3 vision_pdf_parser.py roll.pdf --skip-pages 1,2,30 --dpi 400

Environment Variables:
  GOOGLE_APPLICATION_CREDENTIALS  Path to GCP service account JSON
  MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE  (or MYSQL_URL)
        """
    )
    parser.add_argument('path', help='PDF file or directory of PDFs')
    parser.add_argument('--format', choices=['json', 'csv'], default='json', help='Output format (default: json)')
    parser.add_argument('--out', help='Output file path (default: stdout)')
    parser.add_argument('--db', action='store_true', help='Insert directly into MySQL database')
    parser.add_argument('--batch', action='store_true', help='Process all PDFs in directory')
    parser.add_argument('--skip-pages', default='1,2', help='Pages to skip (default: 1,2)')
    parser.add_argument('--dpi', type=int, default=300, help='PDF rendering DPI (default: 300)')
    parser.add_argument('--migrate', action='store_true', help='Run DB migration only')
    parser.add_argument('--quiet', action='store_true', help='Suppress progress output')

    args = parser.parse_args()

    # DB migration only
    if args.migrate:
        conn = get_db_connection()
        migrate_db(conn)
        conn.close()
        print("Migration complete.", file=sys.stderr)
        return

    # Validate GCP credentials
    if not os.environ.get('GOOGLE_APPLICATION_CREDENTIALS'):
        print("ERROR: Set GOOGLE_APPLICATION_CREDENTIALS environment variable", file=sys.stderr)
        print("  export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json", file=sys.stderr)
        sys.exit(1)

    skip = set(int(x.strip()) for x in args.skip_pages.split(',') if x.strip())
    verbose = not args.quiet

    # Initialize OCR
    ocr = VisionOCR()
    start_time = time.time()

    # Process
    path = Path(args.path)
    if args.batch or path.is_dir():
        voters = process_directory(str(path), ocr, skip_pages=skip, dpi=args.dpi, verbose=verbose)
    else:
        voters = process_pdf(str(path), ocr, skip_pages=skip, dpi=args.dpi, verbose=verbose)

    elapsed = time.time() - start_time

    # Stats
    print_stats(voters)
    print(f"\n  Time elapsed: {elapsed:.1f}s", file=sys.stderr)
    print(f"  Vision API calls: {ocr.call_count}", file=sys.stderr)
    est_cost = ocr.call_count * 0.0015  # $1.50 per 1000
    print(f"  Estimated cost: ${est_cost:.2f}", file=sys.stderr)

    # DB insert
    if args.db:
        print(f"\nInserting into MySQL...", file=sys.stderr)
        conn = get_db_connection()
        migrate_db(conn)

        if args.batch and path.is_dir():
            pdf_files = sorted(path.glob('*.pdf'))
            total_inserted = 0
            total_skipped = 0
            for pdf_file in pdf_files:
                meta = parse_pdf_filename(str(pdf_file))
                pdf_voters = [v for v in voters if v.get('source_pdf') == pdf_file.name]
                if not pdf_voters:
                    # If source_pdf not set, use constituency+part matching
                    pdf_voters = voters  # fallback
                inserted, skipped = insert_voters_batch(conn, pdf_voters, meta, pdf_file.name)
                total_inserted += inserted
                total_skipped += skipped
            print(f"  Inserted: {total_inserted}, Skipped (no EPIC): {total_skipped}", file=sys.stderr)
        else:
            meta = parse_pdf_filename(str(path))
            inserted, skipped = insert_voters_batch(conn, voters, meta, path.name)
            print(f"  Inserted: {inserted}, Skipped (no EPIC): {skipped}", file=sys.stderr)

        conn.close()

    # File/stdout output
    if args.format == 'json':
        output = output_json(voters)
    else:
        output = output_csv(voters)

    if args.out:
        with open(args.out, 'w', encoding='utf-8') as f:
            f.write(output)
        print(f"\nOutput written to: {args.out}", file=sys.stderr)
    elif not args.db:
        print(output)


if __name__ == '__main__':
    main()
