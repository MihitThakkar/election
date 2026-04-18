#!/usr/bin/env python3
"""
Indian Election Voter Roll PDF Parser — Groq Llama Vision + Google Cloud Vision.

Dual-engine approach for 97%+ EPIC accuracy:
  1. Groq Llama 4 Scout: Full page understanding (names, age, gender, structure)
  2. Google Cloud Vision: EPIC verification via pure OCR on cropped EPIC regions

Usage:
  # Activate venv first
  source backend/scripts/venv/bin/activate

  # Single PDF → JSON
  python3 groq_pdf_parser.py /path/to/voter-roll.pdf

  # Single PDF → CSV
  python3 groq_pdf_parser.py /path/to/voter-roll.pdf --format csv --out voters.csv

  # Single PDF → MySQL
  python3 groq_pdf_parser.py /path/to/voter-roll.pdf --db

  # Batch directory → MySQL
  python3 groq_pdf_parser.py /path/to/pdf_folder/ --batch --db

  # Groq-only mode (skip Google Vision verification)
  python3 groq_pdf_parser.py /path/to/voter-roll.pdf --groq-only

Environment:
  GROQ_API_KEY                    Groq API key
  GOOGLE_APPLICATION_CREDENTIALS  GCP service account JSON (for EPIC verification)
  MYSQL_HOST/USER/PASSWORD/DATABASE or MYSQL_URL
"""

import sys
import os
import re
import json
import csv
import io
import argparse
import time
import base64
from pathlib import Path
from collections import Counter

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter
from pdf2image import convert_from_path
from groq import Groq

# Optional Google Vision for EPIC verification
try:
    from google.cloud import vision as gvision
    HAS_GVISION = True
except ImportError:
    HAS_GVISION = False

import mysql.connector


# ---------------------------------------------------------------------------
# EPIC Validation
# ---------------------------------------------------------------------------

EPIC_PATTERNS = [
    re.compile(r'^[A-Z]{3}\d{7}$'),       # XNN1339407 (most common)
    re.compile(r'^[A-Z]{3}\d{6}$'),        # WFX090788, FHR287598
    re.compile(r'^[A-Z]{2}/\d{2}/\d{2,3}/\d{5,8}$'),  # RJ/18/142/120284
]


def is_valid_epic(epic: str) -> bool:
    return any(p.match(epic) for p in EPIC_PATTERNS)


# ---------------------------------------------------------------------------
# JSON Parser (handles LLM output quirks)
# ---------------------------------------------------------------------------

def safe_parse_json(raw: str) -> list:
    """Robustly parse JSON array from LLM output with Hindi text."""
    raw = raw.strip()
    # Strip markdown fences
    raw = re.sub(r'^```(?:json)?\s*', '', raw)
    raw = re.sub(r'\s*```$', '', raw)
    # Fix trailing commas
    raw = re.sub(r',\s*([}\]])', r'\1', raw)

    # Try direct parse
    match = re.search(r'\[[\s\S]*\]', raw)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

    # Fallback: parse object by object
    results = []
    for obj_match in re.finditer(r'\{[^{}]+\}', raw):
        obj_str = obj_match.group()
        try:
            results.append(json.loads(obj_str))
        except json.JSONDecodeError:
            obj = {}
            for field in ['sr_no', 'voter_id', 'epic', 'name', 'father_name',
                          'relation_type', 'house_no', 'age', 'gender']:
                if field in ('sr_no', 'age'):
                    m = re.search(rf'"{field}"\s*:\s*(\d+)', obj_str)
                    if m:
                        obj[field] = int(m.group(1))
                else:
                    m = re.search(rf'"{field}"\s*:\s*"([^"]*)"', obj_str)
                    if m:
                        obj[field] = m.group(1)
            if obj:
                results.append(obj)
    return results


# ---------------------------------------------------------------------------
# Image Helpers
# ---------------------------------------------------------------------------

def enhance_image(img: Image.Image) -> Image.Image:
    """Enhance for OCR: grayscale + contrast + sharpen."""
    gray = img.convert('L')
    gray = ImageEnhance.Contrast(gray).enhance(1.8)
    gray = ImageEnhance.Sharpness(gray).enhance(2.0)
    return gray.convert('RGB')


def image_to_base64(img: Image.Image, fmt='JPEG', quality=90) -> str:
    buf = io.BytesIO()
    img.save(buf, format=fmt, quality=quality)
    return base64.b64encode(buf.getvalue()).decode()


# ---------------------------------------------------------------------------
# Grid Detection (for EPIC cell cropping)
# ---------------------------------------------------------------------------

def detect_grid_cells(image: Image.Image) -> list:
    """Detect voter card grid and return cell bounding boxes."""
    arr = np.array(image.convert('L'))
    h, w = arr.shape

    row_dark = (arr < 128).mean(axis=1)
    grid_rows = np.where(row_dark > 0.35)[0]
    if len(grid_rows) < 4:
        return []

    breaks = np.where(np.diff(grid_rows) > 3)[0]
    h_lines = []
    start = grid_rows[0]
    for b in breaks:
        end = grid_rows[b]
        h_lines.append((start + end) // 2)
        start = grid_rows[b + 1]
    h_lines.append((start + grid_rows[-1]) // 2)

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

    rows = []
    for i in range(0, len(h_lines) - 1, 2):
        row_h = h_lines[i + 1] - h_lines[i]
        if row_h > 50:
            rows.append((h_lines[i], h_lines[i + 1]))

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
        t1 = left_edge + total_w / 3
        t2 = left_edge + 2 * total_w / 3
        s1 = min(separators, key=lambda s: abs(s - t1))
        s2 = min(separators, key=lambda s: abs(s - t2))
        cols = [(left_edge, s1), (s1, s2), (s2, right_edge)]
    else:
        cw = total_w // 3
        cols = [(left_edge, left_edge + cw), (left_edge + cw, left_edge + 2 * cw),
                (left_edge + 2 * cw, right_edge)]

    cells = []
    for rt, rb in rows:
        for cl, cr in cols:
            if (cr - cl) > 80 and (rb - rt) > 50:
                cells.append((cl + 5, rt + 5, cr - 5, rb - 5))
    return cells


def crop_epic_regions(image: Image.Image, cells: list) -> list:
    """Crop top-right corner of each cell (where EPIC is printed)."""
    regions = []
    for x1, y1, x2, y2 in cells:
        cw = x2 - x1
        ch = y2 - y1
        # EPIC is in the top-right ~40% width, top ~25% height
        epic_x1 = x1 + int(cw * 0.55)
        epic_y1 = y1
        epic_x2 = x2
        epic_y2 = y1 + int(ch * 0.25)
        crop = image.crop((epic_x1, epic_y1, epic_x2, epic_y2))
        # Scale up 4x for better OCR
        crop = crop.resize((crop.width * 4, crop.height * 4), Image.LANCZOS)
        regions.append(crop)
    return regions


# ---------------------------------------------------------------------------
# Groq LLM Vision (main extraction)
# ---------------------------------------------------------------------------

def safe_parse_json_obj(raw: str) -> dict:
    """Robustly parse a JSON object (not array) from LLM output."""
    raw = raw.strip()
    raw = re.sub(r'^```(?:json)?\s*', '', raw)
    raw = re.sub(r'\s*```$', '', raw)
    raw = re.sub(r',\s*([}\]])', r'\1', raw)

    match = re.search(r'\{[\s\S]*\}', raw)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            # Try to fix by extracting key-value pairs
            obj = {}
            for m in re.finditer(r'"([^"]+)"\s*:\s*(?:"([^"]*)"|([\d.]+)|(\[[\s\S]*?\])|null|(true|false))', match.group()):
                key = m.group(1)
                if m.group(2) is not None:
                    obj[key] = m.group(2)
                elif m.group(3) is not None:
                    val = m.group(3)
                    obj[key] = int(val) if '.' not in val else float(val)
                elif m.group(4) is not None:
                    try:
                        obj[key] = json.loads(m.group(4))
                    except:
                        obj[key] = m.group(4)
                elif m.group(5) is not None:
                    obj[key] = m.group(5) == 'true'
                else:
                    obj[key] = None
            return obj
    return {}


class GroqExtractor:
    def __init__(self, api_key: str):
        self.client = Groq(api_key=api_key)
        self.model = "meta-llama/llama-4-scout-17b-16e-instruct"
        self.calls = 0

    def extract_pdf_metadata(self, page1_image: Image.Image) -> dict:
        """Extract PDF metadata from page 1 (header/info page) using Groq Vision."""
        enhanced = enhance_image(page1_image)
        b64 = image_to_base64(enhanced, quality=90)

        prompt = """This is PAGE 1 of an Indian Electoral Roll (निर्वाचक नामावली). Extract ALL metadata as JSON.

Return a JSON object with EXACTLY these fields:
{
  "document_title": "निर्वाचक नामावली 2026 S20 राजस्थान",
  "assembly_constituency_no": 155,
  "assembly_constituency_name": "वल्लभनगर",
  "assembly_constituency_reservation": "सामान्य",
  "part_no": 1,
  "parliamentary_constituency_no": 21,
  "parliamentary_constituency_name": "चित्तौड़गढ़",
  "parliamentary_constituency_reservation": "सामान्य",
  "revision_year": 2026,
  "qualifying_date": "01-01-2026",
  "revision_type": "विशेष गहन पुनरीक्षण - 2026",
  "publication_date": "16-12-2025",
  "roll_identity": "समस्त पूरकों को समेकित करते हुए ...",
  "sub_sections": ["1-झाजेता,गोटीपा", "2-उकेलाई,गोटीपा"],
  "main_village": "गोटीपा (भी)",
  "ward": null,
  "post_office": "BALATHAL BO",
  "police_station": "वल्लभ नगर",
  "tehsil": null,
  "district": "उदयपुर",
  "pin_code": "313601",
  "polling_station_no": 1,
  "polling_station_name": "गोटीपा (ऊठाला)",
  "polling_station_category": "सामान्य",
  "auxiliary_stations": 0,
  "polling_station_address": "राजकीय उच्च माध्यमिक विद्यालय, कमरा नम्बर 1, गोटिपा",
  "total_male": 335,
  "total_female": 298,
  "total_third_gender": 0,
  "total_voters": 633,
  "start_sr_no": 1,
  "end_sr_no": 633
}

Read EVERY field carefully from the page. Return ONLY valid JSON. No markdown."""

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                    {"type": "text", "text": prompt}
                ]}],
                max_tokens=4000,
                temperature=0
            )
            self.calls += 1
            return safe_parse_json_obj(response.choices[0].message.content)
        except Exception as e:
            print(f"    Groq metadata error: {e}", file=sys.stderr)
            return {}

    def extract_page(self, image: Image.Image) -> list:
        """Extract all voters from a single page image."""
        enhanced = enhance_image(image)
        b64 = image_to_base64(enhanced, quality=90)

        prompt = """Extract ALL voters from this Indian Electoral Roll page as a JSON array.

Each voter card contains:
- sr_no: serial number (integer, top-left)
- voter_id: EPIC code (top-right, format: 3 uppercase letters + 7 digits, e.g. XNN1339407)
- name: voter name in Hindi (after "निर्वाचक का नाम :")
- father_name: father/husband name in Hindi (after "पिता का नाम :" or "पति का नाम :")
- relation_type: "father" if पिता, "husband" if पति
- house_no: house number (after "गृह संख्या :")
- age: age in years (integer, after "उम्र :" or "उ :")
- gender: "M" if पुरुष, "F" if महिला

IMPORTANT for voter_id (EPIC):
- Standard format: exactly 3 uppercase letters + exactly 7 digits (10 chars total)
- Some use slash format: RJ/18/142/120284 or FJ/18/142/120896
- Read each digit very carefully

Return ONLY a valid JSON array. No markdown. No explanation."""

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                    {"type": "text", "text": prompt}
                ]}],
                max_tokens=8000,
                temperature=0
            )
            self.calls += 1
            return safe_parse_json(response.choices[0].message.content)
        except Exception as e:
            print(f"    Groq error: {e}", file=sys.stderr)
            return []


# ---------------------------------------------------------------------------
# Google Vision OCR (EPIC verification)
# ---------------------------------------------------------------------------

class GVisionVerifier:
    def __init__(self):
        self.client = gvision.ImageAnnotatorClient()
        self.calls = 0

    def ocr_image(self, pil_image: Image.Image) -> str:
        """OCR a PIL image using Google Cloud Vision."""
        buf = io.BytesIO()
        pil_image.save(buf, format='PNG')
        image = gvision.Image(content=buf.getvalue())
        ctx = gvision.ImageContext(language_hints=['en'])
        response = self.client.text_detection(image=image, image_context=ctx)
        self.calls += 1
        if response.text_annotations:
            return response.text_annotations[0].description
        return ''

    def verify_epics(self, page_image: Image.Image, voters: list) -> list:
        """Verify EPICs by OCR-ing the EPIC region of each voter card."""
        cells = detect_grid_cells(page_image)
        if not cells or len(cells) == 0:
            return voters

        epic_regions = crop_epic_regions(page_image, cells)

        # OCR each EPIC region
        verified_epics = []
        for region in epic_regions:
            text = self.ocr_image(region)
            # Extract EPIC pattern from OCR text
            text_clean = text.replace(' ', '').replace('\n', '').upper()
            # Try standard pattern
            m = re.search(r'([A-Z]{3}\d{7})', text_clean)
            if m:
                verified_epics.append(m.group(1))
                continue
            # Try 6-digit pattern
            m = re.search(r'([A-Z]{3}\d{6})', text_clean)
            if m:
                verified_epics.append(m.group(1))
                continue
            # Try slash pattern
            m = re.search(r'([A-Z]{2}/\d{2}/\d{2,3}/\d{5,8})', text_clean)
            if m:
                verified_epics.append(m.group(1))
                continue
            verified_epics.append(None)

        # Match verified EPICs to voters by position
        for i, voter in enumerate(voters):
            if i < len(verified_epics) and verified_epics[i]:
                groq_epic = str(voter.get('voter_id', '')).strip()
                gv_epic = verified_epics[i]

                if groq_epic == gv_epic:
                    voter['epic_confidence'] = 1.0
                    voter['epic_source'] = 'both_agree'
                elif is_valid_epic(gv_epic):
                    # Google Vision OCR is more accurate for pure text
                    voter['voter_id'] = gv_epic
                    voter['epic_confidence'] = 0.95
                    voter['epic_source'] = 'gvision_override'
                    voter['epic_groq'] = groq_epic
                elif is_valid_epic(groq_epic):
                    voter['epic_confidence'] = 0.85
                    voter['epic_source'] = 'groq_only'
                else:
                    voter['epic_confidence'] = 0.5
                    voter['epic_source'] = 'uncertain'
            else:
                if is_valid_epic(str(voter.get('voter_id', ''))):
                    voter['epic_confidence'] = 0.85
                    voter['epic_source'] = 'groq_only'

        return voters


# ---------------------------------------------------------------------------
# PDF Metadata (from filename)
# ---------------------------------------------------------------------------

def parse_pdf_filename(filepath: str) -> dict:
    meta = {'year': None, 'state_code': None, 'constituency_no': None,
            'part_no': None, 'roll_type': None}
    name = Path(filepath).stem

    m = re.search(r'^(\d{4})', name)
    if m: meta['year'] = int(m.group(1))

    if 'EROLLGEN' in name: meta['roll_type'] = 'EROLL'
    elif 'SUPPLEMENTGEN' in name: meta['roll_type'] = 'SUPPLEMENT'

    m = re.search(r'S(\d{1,2})', name)
    if m: meta['state_code'] = f'S{m.group(1)}'

    parts = name.split('-')
    for i, p in enumerate(parts):
        if p.startswith('S') and p[1:].isdigit() and i + 1 < len(parts):
            try: meta['constituency_no'] = int(parts[i + 1])
            except ValueError: pass
            break

    m = re.search(r'-(\d+)-WI', name)
    if m: meta['part_no'] = int(m.group(1))

    return meta


# ---------------------------------------------------------------------------
# MySQL
# ---------------------------------------------------------------------------

def get_db_connection():
    if os.environ.get('MYSQL_URL'):
        from urllib.parse import urlparse
        url = urlparse(os.environ['MYSQL_URL'])
        return mysql.connector.connect(
            host=url.hostname, port=url.port or 3306,
            user=url.username, password=url.password,
            database=url.path.lstrip('/'))
    return mysql.connector.connect(
        host=os.environ.get('MYSQL_HOST', 'localhost'),
        user=os.environ.get('MYSQL_USER', 'root'),
        password=os.environ.get('MYSQL_PASSWORD', ''),
        database=os.environ.get('MYSQL_DATABASE', 'election'),
        port=int(os.environ.get('MYSQL_PORT', 3306)))


def migrate_db(conn):
    cursor = conn.cursor()
    cols = [
        ("state_code", "VARCHAR(10)"), ("constituency_no", "INT"),
        ("constituency_name", "VARCHAR(255)"), ("part_no", "INT"),
        ("sr_no", "INT"), ("house_no", "VARCHAR(100)"),
        ("relation_type", "VARCHAR(10)"), ("epic_confidence", "FLOAT"),
        ("roll_type", "VARCHAR(20)"), ("roll_year", "INT"),
        ("source_pdf", "VARCHAR(500)"),
        # Page 1 metadata columns
        ("parliamentary_constituency_no", "INT"),
        ("parliamentary_constituency_name", "VARCHAR(255)"),
        ("main_village", "VARCHAR(255)"),
        ("post_office", "VARCHAR(255)"),
        ("police_station", "VARCHAR(255)"),
        ("tehsil", "VARCHAR(255)"),
        ("district", "VARCHAR(255)"),
        ("pin_code", "VARCHAR(10)"),
        ("polling_station_no", "INT"),
        ("polling_station_name", "VARCHAR(255)"),
        ("polling_station_category", "VARCHAR(50)"),
        ("polling_station_address", "VARCHAR(500)"),
        ("sub_section", "VARCHAR(255)"),
    ]
    for col, typ in cols:
        try:
            cursor.execute(f"ALTER TABLE voters ADD COLUMN {col} {typ} DEFAULT NULL")
        except: pass
    conn.commit()
    cursor.close()


def insert_voters_batch(conn, voters: list, meta: dict, source_pdf: str):
    cursor = conn.cursor()
    sql = """INSERT INTO voters
      (name, age, voter_id, father_name, gender, address,
       state_code, constituency_no, constituency_name, part_no, sr_no, house_no,
       relation_type, epic_confidence, roll_type, roll_year, source_pdf,
       parliamentary_constituency_no, parliamentary_constituency_name,
       main_village, post_office, police_station, tehsil, district, pin_code,
       polling_station_no, polling_station_name, polling_station_category,
       polling_station_address, sub_section)
    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    ON DUPLICATE KEY UPDATE
      name=VALUES(name), age=VALUES(age), father_name=VALUES(father_name),
      gender=VALUES(gender), state_code=VALUES(state_code),
      constituency_no=VALUES(constituency_no), constituency_name=VALUES(constituency_name),
      part_no=VALUES(part_no), sr_no=VALUES(sr_no), house_no=VALUES(house_no),
      relation_type=VALUES(relation_type), epic_confidence=VALUES(epic_confidence),
      roll_type=VALUES(roll_type), roll_year=VALUES(roll_year),
      source_pdf=VALUES(source_pdf),
      parliamentary_constituency_no=VALUES(parliamentary_constituency_no),
      parliamentary_constituency_name=VALUES(parliamentary_constituency_name),
      main_village=VALUES(main_village), post_office=VALUES(post_office),
      police_station=VALUES(police_station), tehsil=VALUES(tehsil),
      district=VALUES(district), pin_code=VALUES(pin_code),
      polling_station_no=VALUES(polling_station_no),
      polling_station_name=VALUES(polling_station_name),
      polling_station_category=VALUES(polling_station_category),
      polling_station_address=VALUES(polling_station_address),
      sub_section=VALUES(sub_section)"""

    batch = []
    skipped = 0
    for v in voters:
        vid = v.get('voter_id')
        if not vid:
            skipped += 1
            continue
        addr = f"House {v.get('house_no', '')}" if v.get('house_no') else None
        batch.append((
            v.get('name'), v.get('age'), vid, v.get('father_name'),
            v.get('gender'), addr, v.get('state_code', meta.get('state_code')),
            v.get('constituency_no', meta.get('constituency_no')),
            v.get('constituency_name'), v.get('part_no', meta.get('part_no')),
            v.get('sr_no'), v.get('house_no'), v.get('relation_type'),
            v.get('epic_confidence'), v.get('roll_type', meta.get('roll_type')),
            v.get('roll_year', meta.get('year')), source_pdf,
            v.get('parliamentary_constituency_no'),
            v.get('parliamentary_constituency_name'),
            v.get('main_village'), v.get('post_office'),
            v.get('police_station'), v.get('tehsil'),
            v.get('district'), v.get('pin_code'),
            v.get('polling_station_no'), v.get('polling_station_name'),
            v.get('polling_station_category'), v.get('polling_station_address'),
            v.get('sub_section')))

    if batch:
        cursor.executemany(sql, batch)
        conn.commit()
    cursor.close()
    return len(batch), skipped


# ---------------------------------------------------------------------------
# Main Pipeline
# ---------------------------------------------------------------------------

def process_pdf(pdf_path: str, groq_ext: GroqExtractor,
                gv_verifier=None, skip_pages: set = None,
                dpi: int = 300, verbose: bool = True) -> tuple:
    """Process PDF and return (voters_list, pdf_metadata_dict)."""
    if skip_pages is None:
        skip_pages = {1, 2}

    pdf_name = Path(pdf_path).name
    file_meta = parse_pdf_filename(pdf_path)

    if verbose:
        print(f"\n{'='*60}", file=sys.stderr)
        print(f"Processing: {pdf_name}", file=sys.stderr)
        print(f"File metadata: {json.dumps(file_meta, default=str)}", file=sys.stderr)
        print(f"Converting PDF → images ({dpi} DPI)...", file=sys.stderr)

    images = convert_from_path(pdf_path, dpi=dpi)
    total_pages = len(images)
    if verbose:
        print(f"Pages: {total_pages}", file=sys.stderr)

    # ---- Step 0: Parse page 1 metadata via Groq Vision ----
    if verbose:
        print(f"  Page 1/{total_pages}: extracting PDF metadata...", file=sys.stderr, end='', flush=True)
    pdf_meta = groq_ext.extract_pdf_metadata(images[0])
    time.sleep(2)

    # Merge file_meta with parsed page-1 metadata (page-1 takes priority)
    meta = {**file_meta}
    if pdf_meta.get('assembly_constituency_no'):
        meta['constituency_no'] = pdf_meta['assembly_constituency_no']
    if pdf_meta.get('part_no'):
        meta['part_no'] = pdf_meta['part_no']
    if pdf_meta.get('revision_year'):
        meta['year'] = pdf_meta['revision_year']

    if verbose:
        ac_name = pdf_meta.get('assembly_constituency_name', '?')
        village = pdf_meta.get('main_village', '?')
        ps_name = pdf_meta.get('polling_station_name', '?')
        part = meta.get('part_no', '?')
        cat = pdf_meta.get('polling_station_category', '?')
        print(f" done", file=sys.stderr)
        print(f"    Constituency: {meta.get('constituency_no')} - {ac_name}", file=sys.stderr)
        print(f"    Part No: {part} | Village: {village}", file=sys.stderr)
        print(f"    Polling Station: {ps_name} ({cat})", file=sys.stderr)
        print(f"    District: {pdf_meta.get('district', '?')} | PIN: {pdf_meta.get('pin_code', '?')}", file=sys.stderr)
        total_v = pdf_meta.get('total_voters', '?')
        m_v = pdf_meta.get('total_male', '?')
        f_v = pdf_meta.get('total_female', '?')
        print(f"    Voters: {total_v} (M:{m_v} F:{f_v})", file=sys.stderr)
    print(f"  Page 2/{total_pages}: skipped (maps/photos)", file=sys.stderr)

    all_voters = []
    global_sr = 0

    for page_num, image in enumerate(images, 1):
        if page_num in skip_pages or page_num == total_pages:
            if page_num > 2 and page_num != total_pages:
                if verbose:
                    print(f"  Page {page_num}/{total_pages}: skipped", file=sys.stderr)
            continue

        if verbose:
            print(f"  Page {page_num}/{total_pages}: ", file=sys.stderr, end='', flush=True)

        # Step 1: Groq extraction (full page understanding)
        voters = groq_ext.extract_page(image)
        if verbose:
            print(f"{len(voters)} voters", file=sys.stderr, end='', flush=True)

        # Step 2: Google Vision EPIC verification (if available)
        if gv_verifier:
            voters = gv_verifier.verify_epics(image, voters)
            overrides = sum(1 for v in voters if v.get('epic_source') == 'gvision_override')
            if verbose and overrides:
                print(f" ({overrides} EPIC corrected)", file=sys.stderr, end='', flush=True)

        # Assign sr_no, defaults, and attach page-1 metadata to each voter
        for v in voters:
            global_sr += 1
            v.setdefault('sr_no', global_sr)
            v.setdefault('voter_id', None)
            v.setdefault('name', None)
            v.setdefault('father_name', None)
            v.setdefault('relation_type', None)
            v.setdefault('age', None)
            v.setdefault('gender', None)
            v.setdefault('house_no', None)
            v.setdefault('epic_confidence', 0.85)

            # Attach PDF metadata to every voter record
            v['state_code'] = meta.get('state_code')
            v['constituency_no'] = meta.get('constituency_no')
            v['constituency_name'] = pdf_meta.get('assembly_constituency_name')
            v['part_no'] = meta.get('part_no')
            v['roll_type'] = meta.get('roll_type')
            v['roll_year'] = meta.get('year')
            v['parliamentary_constituency_no'] = pdf_meta.get('parliamentary_constituency_no')
            v['parliamentary_constituency_name'] = pdf_meta.get('parliamentary_constituency_name')
            v['main_village'] = pdf_meta.get('main_village')
            v['post_office'] = pdf_meta.get('post_office')
            v['police_station'] = pdf_meta.get('police_station')
            v['tehsil'] = pdf_meta.get('tehsil')
            v['district'] = pdf_meta.get('district')
            v['pin_code'] = pdf_meta.get('pin_code')
            v['polling_station_no'] = pdf_meta.get('polling_station_no')
            v['polling_station_name'] = pdf_meta.get('polling_station_name')
            v['polling_station_category'] = pdf_meta.get('polling_station_category')
            v['polling_station_address'] = pdf_meta.get('polling_station_address')
            # Sub-sections as comma-separated string
            subs = pdf_meta.get('sub_sections')
            v['sub_section'] = ', '.join(subs) if isinstance(subs, list) else subs

        all_voters.extend(voters)

        if verbose:
            print("", file=sys.stderr)

        # Rate limit: Groq has ~30 req/min on free tier
        time.sleep(2)

    return all_voters, pdf_meta


def print_stats(voters: list, groq_calls: int, gv_calls: int):
    total = len(voters)
    if total == 0:
        print("\nNo voters extracted.", file=sys.stderr)
        return

    fields = {
        'voter_id (EPIC)': sum(1 for v in voters if v.get('voter_id')),
        'name': sum(1 for v in voters if v.get('name')),
        'father_name': sum(1 for v in voters if v.get('father_name')),
        'age': sum(1 for v in voters if v.get('age')),
        'gender': sum(1 for v in voters if v.get('gender')),
        'house_no': sum(1 for v in voters if v.get('house_no')),
    }

    print(f"\n{'='*60}", file=sys.stderr)
    print(f"EXTRACTION RESULTS", file=sys.stderr)
    print(f"{'='*60}", file=sys.stderr)
    print(f"Total voters: {total}", file=sys.stderr)

    for field, count in fields.items():
        pct = count * 100 / total
        ok = '✓' if pct >= 97 else '⚠' if pct >= 90 else '✗'
        print(f"  {ok} {field:20s}: {count:5d}/{total} ({pct:5.1f}%)", file=sys.stderr)

    # EPIC confidence
    epic_voters = [v for v in voters if v.get('voter_id')]
    if epic_voters:
        confs = [v.get('epic_confidence', 0) for v in epic_voters]
        both = sum(1 for v in epic_voters if v.get('epic_source') == 'both_agree')
        gv_fix = sum(1 for v in epic_voters if v.get('epic_source') == 'gvision_override')
        groq_only = sum(1 for v in epic_voters if v.get('epic_source') in ('groq_only', None))
        print(f"\n  EPIC Sources:", file=sys.stderr)
        print(f"    Both agree (high conf):    {both}", file=sys.stderr)
        print(f"    GVision corrected:         {gv_fix}", file=sys.stderr)
        print(f"    Groq only:                 {groq_only}", file=sys.stderr)

    print(f"\n  API Calls: Groq={groq_calls}, GVision={gv_calls}", file=sys.stderr)
    groq_cost = groq_calls * 0.0003  # rough estimate
    gv_cost = gv_calls * 0.0015
    print(f"  Est. Cost: Groq ~${groq_cost:.2f}, GVision ~${gv_cost:.2f}", file=sys.stderr)


FIELDS = [
    'sr_no', 'name', 'father_name', 'relation_type', 'age', 'gender',
    'voter_id', 'epic_confidence', 'house_no',
    # Constituency & Part
    'state_code', 'constituency_no', 'constituency_name', 'part_no',
    # Parliamentary
    'parliamentary_constituency_no', 'parliamentary_constituency_name',
    # Location
    'main_village', 'district', 'tehsil', 'post_office', 'police_station', 'pin_code',
    # Polling Station
    'polling_station_no', 'polling_station_name', 'polling_station_category',
    'polling_station_address',
    # Sub-sections
    'sub_section',
    # Roll info
    'roll_type', 'roll_year',
]


def output_json(voters: list, pdf_meta: dict = None) -> str:
    """Output voters as JSON with optional pdf_metadata wrapper."""
    clean_voters = [{k: v.get(k) for k in FIELDS} for v in voters]
    if pdf_meta:
        output = {
            "pdf_metadata": pdf_meta,
            "voters": clean_voters,
            "total_voters": len(clean_voters),
        }
    else:
        output = clean_voters
    return json.dumps(output, ensure_ascii=False, indent=2)


def output_csv(voters: list) -> str:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=FIELDS, extrasaction='ignore')
    writer.writeheader()
    for v in voters:
        writer.writerow({k: v.get(k, '') for k in FIELDS})
    return buf.getvalue()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description='Parse Indian Election Voter Roll PDFs (Groq + Google Vision)')
    parser.add_argument('path', help='PDF file or directory')
    parser.add_argument('--format', choices=['json', 'csv'], default='json')
    parser.add_argument('--out', help='Output file path')
    parser.add_argument('--db', action='store_true', help='Insert into MySQL')
    parser.add_argument('--batch', action='store_true', help='Process all PDFs in dir')
    parser.add_argument('--skip-pages', default='1,2', help='Pages to skip')
    parser.add_argument('--dpi', type=int, default=300, help='PDF render DPI')
    parser.add_argument('--groq-only', action='store_true',
                        help='Skip Google Vision verification')
    parser.add_argument('--migrate', action='store_true', help='Run DB migration only')
    parser.add_argument('--quiet', action='store_true')
    args = parser.parse_args()

    if args.migrate:
        conn = get_db_connection()
        migrate_db(conn)
        conn.close()
        print("Migration complete.", file=sys.stderr)
        return

    # Init Groq
    groq_key = os.environ.get('GROQ_API_KEY')
    if not groq_key:
        print("Error: GROQ_API_KEY environment variable is required.", file=sys.stderr)
        print("  Set it in .env or export GROQ_API_KEY=gsk_...", file=sys.stderr)
        sys.exit(1)
    groq_ext = GroqExtractor(groq_key)

    # Init Google Vision (optional)
    gv_verifier = None
    if not args.groq_only and HAS_GVISION and os.environ.get('GOOGLE_APPLICATION_CREDENTIALS'):
        gv_verifier = GVisionVerifier()
        if not args.quiet:
            print("Google Vision EPIC verification: ENABLED", file=sys.stderr)
    else:
        if not args.quiet:
            print("Google Vision EPIC verification: DISABLED (Groq-only mode)", file=sys.stderr)

    skip = set(int(x.strip()) for x in args.skip_pages.split(',') if x.strip())
    verbose = not args.quiet
    start = time.time()

    path = Path(args.path)
    all_pdf_meta = {}

    if args.batch or path.is_dir():
        pdf_files = sorted(path.glob('*.pdf'))
        if not pdf_files:
            print(f"No PDFs in {path}", file=sys.stderr)
            return
        print(f"Found {len(pdf_files)} PDFs", file=sys.stderr)
        all_voters = []
        for i, pdf in enumerate(pdf_files, 1):
            print(f"\n[{i}/{len(pdf_files)}]", file=sys.stderr, end='')
            voters, pdf_meta = process_pdf(str(pdf), groq_ext, gv_verifier,
                                           skip_pages=skip, dpi=args.dpi, verbose=verbose)
            for v in voters:
                v['source_pdf'] = pdf.name
            all_voters.extend(voters)
            all_pdf_meta[pdf.name] = pdf_meta

            # DB insert per-PDF in batch mode
            if args.db:
                conn = get_db_connection()
                migrate_db(conn)
                file_meta = parse_pdf_filename(str(pdf))
                inserted, skipped = insert_voters_batch(conn, voters, file_meta, pdf.name)
                if verbose:
                    print(f"    DB: {inserted} inserted, {skipped} skipped", file=sys.stderr)
                conn.close()

        voters = all_voters
    else:
        voters, pdf_meta = process_pdf(str(path), groq_ext, gv_verifier,
                                       skip_pages=skip, dpi=args.dpi, verbose=verbose)
        all_pdf_meta[path.name] = pdf_meta
        for v in voters:
            v['source_pdf'] = path.name

    elapsed = time.time() - start
    gv_calls = gv_verifier.calls if gv_verifier else 0
    print_stats(voters, groq_ext.calls, gv_calls)
    print(f"\n  Time: {elapsed:.1f}s", file=sys.stderr)

    # DB insert (single file mode)
    if args.db and not (args.batch or path.is_dir()):
        print(f"\nInserting into MySQL...", file=sys.stderr)
        conn = get_db_connection()
        migrate_db(conn)
        file_meta = parse_pdf_filename(str(path))
        inserted, skipped = insert_voters_batch(conn, voters, file_meta, path.name)
        print(f"  Inserted: {inserted}, Skipped (no EPIC): {skipped}", file=sys.stderr)
        conn.close()

    # Output
    single_meta = all_pdf_meta.get(path.name) if not (args.batch or path.is_dir()) else None
    if args.format == 'json':
        output = output_json(voters, pdf_meta=single_meta)
    else:
        output = output_csv(voters)

    if args.out:
        with open(args.out, 'w', encoding='utf-8') as f:
            f.write(output)
        print(f"\nOutput: {args.out}", file=sys.stderr)

        # Also write metadata JSON alongside CSV
        if args.format == 'csv' and single_meta:
            meta_path = args.out.replace('.csv', '_metadata.json')
            with open(meta_path, 'w', encoding='utf-8') as f:
                json.dump(single_meta, f, ensure_ascii=False, indent=2)
            print(f"Metadata: {meta_path}", file=sys.stderr)
    elif not args.db:
        print(output)


if __name__ == '__main__':
    main()
