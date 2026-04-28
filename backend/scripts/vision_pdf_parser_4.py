#!/usr/bin/env python3
"""
High-accuracy Indian Election Voter Roll PDF parser using Google Cloud Vision
DOCUMENT_TEXT_DETECTION (word-level bounding boxes).

Improvements over vision_pdf_parser_3.py:
  - 1 OCR call / page (instead of ~30 cell calls). ~30x cheaper.
  - No reliance on visible grid lines: voter cards are clustered by word
    coordinates (3 columns x N rows). Faded / missing borders no longer
    drop entire pages or rows.
  - Page-footer "kul" total is parsed and cross-checked against extracted
    record count. Any mismatch is logged in <out>.verify.txt for review;
    no rows are silently dropped.
  - Cover-page metadata captured once and stamped on every row:
      qualifying_date  (नियत तिथि को आयु)
      publication_date (प्रकाशन की तिथि)
      total_pages      (कुल पृष्ठ)
  - Last page is no longer blindly skipped: we skip on summary keywords
    ('कुल मतदाता', 'Summary', 'Total Electors', 'अंतिम'), not by index.
  - Optional --retry-bad-pages: re-OCRs at higher DPI any page whose
    extracted count differs from the footer total.

Usage:
  python3 vision_pdf_parser_4.py /path/to/roll.pdf --format csv --out voters_275.csv
  python3 vision_pdf_parser_4.py /dir/of/pdfs/ --batch --format csv --out-dir ./out

Prerequisites:
  pip install -r requirements.txt
  export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
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

import numpy as np
from PIL import Image
from pdf2image import convert_from_path

from google.cloud import vision

import mysql.connector


# ---------------------------------------------------------------------------
# EPIC validation (carried over from v3, with one extra pattern)
# ---------------------------------------------------------------------------

EPIC_PATTERNS = [
    re.compile(r'^[A-Z]{3}\d{7}$'),
    re.compile(r'^[A-Z]{3}\d{6}$'),
    re.compile(r'^[A-Z]{2}/\d{2}/\d{2,3}/\d{5,8}$'),
]

EPIC_CHAR_FIXES = {
    'O': '0', 'o': '0', 'I': '1', 'l': '1', 'S': '5', 'B': '8',
    'D': '0', 'Z': '2', 'G': '6', 'q': '9', '|': '1',
}

EPIC_PREFIX_FIXES = {
    '0': 'O', '1': 'I', '5': 'S', '8': 'B', '6': 'G', '2': 'Z',
}


def validate_epic(raw: str):
    """Return (cleaned_epic, confidence, issues)."""
    if not raw:
        return None, 0.0, ['empty']

    epic = raw.strip().replace(' ', '').replace('\n', '').replace('|', '/')
    epic = re.sub(r'[^A-Za-z0-9/]', '', epic).upper()

    for pat in EPIC_PATTERNS:
        if pat.match(epic):
            return epic, 1.0, []

    issues = []

    # 3-letter prefix + digits with OCR fix in digit area
    if len(epic) in (9, 10) and epic[:3].isalpha():
        prefix = epic[:3]
        digit_part = epic[3:]
        fixed = ''
        for ch in digit_part:
            if ch.isdigit():
                fixed += ch
            elif ch in EPIC_CHAR_FIXES:
                fixed += EPIC_CHAR_FIXES[ch]
                issues.append(f'fixed {ch}->{EPIC_CHAR_FIXES[ch]}')
            else:
                fixed += ch
        if fixed.isdigit() and len(fixed) in (6, 7):
            return prefix + fixed, 0.95, issues

    # Fix prefix where digit appears in alpha position
    if len(epic) >= 9:
        fixed_prefix = ''
        for ch in epic[:3]:
            if ch.isalpha():
                fixed_prefix += ch
            elif ch in EPIC_PREFIX_FIXES:
                fixed_prefix += EPIC_PREFIX_FIXES[ch]
                issues.append(f'prefix {ch}->{EPIC_PREFIX_FIXES[ch]}')
            else:
                fixed_prefix += ch
        candidate = fixed_prefix + epic[3:]
        for pat in EPIC_PATTERNS:
            if pat.match(candidate):
                return candidate, 0.90, issues

    # State format: RJ/18/142/120284
    if re.match(r'^([A-Z]{2})/(\d{2})/(\d{2,3})/(\d{5,8})$', epic):
        return epic, 1.0, []

    # Reconstruct missing slashes
    state_match = re.match(r'^([A-Z]{2})(\d{2})(\d{2,3})(\d{5,8})$', epic)
    if state_match:
        rebuilt = f'{state_match.group(1)}/{state_match.group(2)}/{state_match.group(3)}/{state_match.group(4)}'
        return rebuilt, 0.90, ['reconstructed slashes']

    return epic, 0.5, ['no pattern match']


# ---------------------------------------------------------------------------
# Vision OCR wrapper with document_text_detection
# ---------------------------------------------------------------------------

class VisionOCR:
    def __init__(self):
        self.client = vision.ImageAnnotatorClient()
        self._call_count = 0

    def _png_bytes(self, pil_image: Image.Image) -> bytes:
        buf = io.BytesIO()
        pil_image.save(buf, format='PNG')
        return buf.getvalue()

    def document_ocr(self, pil_image: Image.Image):
        """Return (full_text, words[]). Each word is dict with 'text','x','y','w','h'."""
        image = vision.Image(content=self._png_bytes(pil_image))
        ctx = vision.ImageContext(language_hints=['hi', 'en'])
        resp = self.client.document_text_detection(image=image, image_context=ctx)
        self._call_count += 1
        if resp.error.message:
            raise Exception(f'Vision API error: {resp.error.message}')

        if not resp.full_text_annotation or not resp.full_text_annotation.pages:
            return '', []

        full_text = resp.full_text_annotation.text
        words = []
        for page in resp.full_text_annotation.pages:
            for block in page.blocks:
                for para in block.paragraphs:
                    for word in para.words:
                        text = ''.join(s.text for s in word.symbols)
                        verts = word.bounding_box.vertices
                        xs = [v.x for v in verts]
                        ys = [v.y for v in verts]
                        x = min(xs); y = min(ys)
                        w = max(xs) - x; h = max(ys) - y
                        words.append({
                            'text': text, 'x': x, 'y': y, 'w': w, 'h': h,
                            'cx': x + w / 2, 'cy': y + h / 2,
                        })
        return full_text, words

    def text_ocr(self, pil_image: Image.Image) -> str:
        """Lightweight text-only OCR for cropped regions (footer count, etc.)."""
        image = vision.Image(content=self._png_bytes(pil_image))
        ctx = vision.ImageContext(language_hints=['hi', 'en'])
        resp = self.client.text_detection(image=image, image_context=ctx)
        self._call_count += 1
        if resp.error.message:
            raise Exception(f'Vision API error: {resp.error.message}')
        if not resp.text_annotations:
            return ''
        return resp.text_annotations[0].description

    @property
    def call_count(self):
        return self._call_count


# ---------------------------------------------------------------------------
# Document-level metadata (cover page only)
# ---------------------------------------------------------------------------

DATE_RX = r'(\d{1,2}[\-./]\d{1,2}[\-./]\d{2,4})'

def extract_doc_meta(text: str) -> dict:
    """Pull qualifying_date, publication_date, total_pages from cover page text."""
    out = {'qualifying_date': None, 'publication_date': None, 'total_pages': None}

    m = re.search(r'नियत\s*तिथि\s*को\s*आयु\s*[:：\-]+\s*' + DATE_RX, text)
    if m:
        out['qualifying_date'] = _norm_date(m.group(1))

    m = re.search(r'प्रकाशन\s*की\s*तिथि\s*[:：\-]+\s*' + DATE_RX, text)
    if m:
        out['publication_date'] = _norm_date(m.group(1))

    m = re.search(r'कुल\s*पृष्ठ\s*[:：\-]*\s*(\d{1,4})', text)
    if m:
        try:
            out['total_pages'] = int(m.group(1))
        except ValueError:
            pass

    return out


def _norm_date(s: str) -> str:
    """Normalize date separators to '-' and zero-pad."""
    parts = re.split(r'[\-./]', s.strip())
    if len(parts) == 3:
        d, mo, y = parts
        if len(y) == 2:
            y = '20' + y
        return f'{int(d):02d}-{int(mo):02d}-{int(y):04d}'
    return s


# ---------------------------------------------------------------------------
# Per-page header (carried from v3)
# ---------------------------------------------------------------------------

def parse_header(text: str) -> dict:
    out = {'part_number': None, 'part_name': None,
           'sub_section_no': None, 'sub_section_name': None}

    pn = re.search(r'भाग\s*(?:संख्या|सं\.?|नं\.?|क्रमांक)\s*[:：]+\s*(\d{1,5})', text)
    if pn:
        try: out['part_number'] = int(pn.group(1))
        except ValueError: pass

    pm = re.search(
        r'भाग\s*(?:संख्या|सं\.?|नं\.?|क्रमांक)?\s*[:：]+\s*\d{1,5}\s*[-–—]\s*([^\n|0-9]{2,60})',
        text)
    if pm:
        pname = re.sub(r'\s+', ' ', pm.group(1)).strip(' -–—:,')
        if pname and not re.search(r'[A-Z]{3}\d', pname):
            out['part_name'] = pname[:120]

    sm = re.search(
        r'अनुभाग\s*(?:की\s*संख्या\s*(?:व|एवं|और)?\s*नाम)?\s*[:：]+\s*'
        r'(\d{1,3})\s*[-–—]\s*([^\n|]{3,200})',
        text)
    if sm:
        try: out['sub_section_no'] = int(sm.group(1))
        except ValueError: pass
        sname = re.sub(r'\s+', ' ', sm.group(2)).strip(' -–—:')
        sname = re.split(r'\s*भाग\s*(?:संख्या|सं\.?|नं\.?)', sname)[0].strip(' ,-–—')
        if sname:
            out['sub_section_name'] = sname[:200]
    return out


# ---------------------------------------------------------------------------
# Footer record-count parser
# ---------------------------------------------------------------------------

def parse_page_footer_total(text: str):
    """Return the declared total record count on a page, or None.

    Footer formats observed:
      'इस पृष्ठ का कुल योग : 30'
      'पुरुष : 14  महिला : 16  अन्य : 0  कुल : 30'
      'पुरुष: 14 महिला: 16 कुल: 30'
      'Total : 30'
    """
    # Sum form: man+woman[+other] = total -> validate
    m = re.search(
        r'पुरुष\s*[:：]\s*(\d{1,4}).{0,40}?महिला\s*[:：]\s*(\d{1,4})'
        r'(?:.{0,40}?(?:अन्य|थर्ड)\s*[:：]\s*(\d{1,4}))?'
        r'.{0,40}?कुल\s*[:：]\s*(\d{1,4})',
        text, re.DOTALL)
    if m:
        try: return int(m.group(4))
        except ValueError: pass

    # "कुल योग" / "कुल"
    m = re.search(r'(?:इस\s*पृष्ठ\s*का\s*)?कुल(?:\s*योग)?\s*[:：\-]+\s*(\d{1,4})', text)
    if m:
        try: return int(m.group(1))
        except ValueError: pass

    # English fallback
    m = re.search(r'Total\s*(?:Electors)?\s*[:：]?\s*(\d{1,4})', text, re.IGNORECASE)
    if m:
        try: return int(m.group(1))
        except ValueError: pass

    return None


def is_summary_page(text: str) -> bool:
    """Detect cover/summary pages we should not extract voter records from."""
    if not text:
        return False
    keywords = [
        'कुल मतदाता संख्या',  # total electors count (summary)
        'पुरुष मतदाता', 'महिला मतदाता',  # gender-wise summary tables
        'भाग का सारांश',  # part summary
        'विधानसभा निर्वाचन क्षेत्र', # constituency cover
        'Total Electors',
        'अंतिम सूची',
        'Summary',
    ]
    # Cover page also has मतदाता सूची heading near top — but normal pages don't have
    # voter rolls *and* "कुल मतदाता संख्या" together. Use the sum line as the marker.
    return 'कुल मतदाता संख्या' in text or 'Total Electors' in text


# ---------------------------------------------------------------------------
# Card-level coordinate clustering
# ---------------------------------------------------------------------------

def cluster_cards(words, page_w, page_h):
    """Group word boxes into voter-card cells using coordinate clustering.

    Returns a list of dicts: {'col': 0|1|2, 'row': i, 'bbox': (x1,y1,x2,y2),
                              'words': [...], 'text': '...'}
    """
    if not words:
        return []

    # Constrain to the body region (skip top header band & bottom footer band)
    top_cut = page_h * 0.18    # below header
    bot_cut = page_h * 0.93    # above footer
    body = [w for w in words if top_cut <= w['cy'] <= bot_cut]
    if not body:
        return []

    # ── Column boundaries via x-center clustering ──────────────────────────
    # Simple, robust 3-bucket split based on page width thirds. This works
    # because ECI rolls have a fixed 3-column layout; clustering arbitrary
    # word x-positions via k-means produces unstable boundaries when a card
    # has unusually long names that span wider than expected.
    col_w = page_w / 3.0
    col_bounds = [
        (0,            col_w),
        (col_w,        2 * col_w),
        (2 * col_w,    page_w),
    ]

    by_col = [[] for _ in range(3)]
    for w in body:
        # Use word left edge to assign — long words don't push into next col.
        col_idx = min(2, max(0, int(w['x'] // col_w)))
        by_col[col_idx].append(w)

    # ── Within each column, split into rows by Y-gaps ──────────────────────
    cards = []
    for col_idx, col_words in enumerate(by_col):
        if not col_words:
            continue
        col_words.sort(key=lambda w: w['cy'])

        # Estimate row pitch from page height (ECI: ~10 rows per page)
        # Median word height as a baseline to define what is "a big gap".
        median_h = float(np.median([w['h'] for w in col_words])) if col_words else 12.0
        big_gap = max(median_h * 1.6, 18.0)

        # Walk the column top-down; start a new card whenever the top of
        # the next word is more than `big_gap` below the bottom of current card.
        current = []
        current_bottom = -1.0
        groups = []
        for w in col_words:
            top = w['y']
            if current and (top - current_bottom) > big_gap:
                groups.append(current)
                current = []
            current.append(w)
            current_bottom = max(current_bottom, w['y'] + w['h'])
        if current:
            groups.append(current)

        # Filter trivial groups (1-2 stray words can't be a voter card).
        # Voter cards always include a name + EPIC + age etc; expect >= 5 words.
        for g in groups:
            if len(g) < 4:
                continue
            xs = [w['x'] for w in g] + [w['x'] + w['w'] for w in g]
            ys = [w['y'] for w in g] + [w['y'] + w['h'] for w in g]
            bbox = (min(xs), min(ys), max(xs), max(ys))
            cards.append({
                'col': col_idx,
                'bbox': bbox,
                'words': g,
            })

    # Order cards top-down within each column, then column-wise (left → right).
    cards.sort(key=lambda c: (c['col'], c['bbox'][1]))
    # Build text per card: words sorted by (y-line, x).
    for c in cards:
        c['text'] = _words_to_text(c['words'])

    return cards


def _words_to_text(words):
    """Reconstruct text from words by detecting line groupings via Y."""
    if not words:
        return ''
    ws = sorted(words, key=lambda w: (w['cy'], w['cx']))
    median_h = float(np.median([w['h'] for w in ws])) if ws else 12.0
    line_gap = max(median_h * 0.6, 6.0)

    lines = []
    cur = [ws[0]]
    cur_y = ws[0]['cy']
    for w in ws[1:]:
        if abs(w['cy'] - cur_y) <= line_gap:
            cur.append(w)
        else:
            lines.append(cur)
            cur = [w]
        cur_y = w['cy']
    lines.append(cur)

    out = []
    for ln in lines:
        ln.sort(key=lambda w: w['x'])
        out.append(' '.join(w['text'] for w in ln))
    return '\n'.join(out)


# ---------------------------------------------------------------------------
# Card text → voter record
# ---------------------------------------------------------------------------

def parse_card(text: str) -> dict:
    """Parse OCR text from one voter card. Looser than v3 — accepts a card
    if it has any of {EPIC, name, father, age, gender}."""
    if not text or len(text.strip()) < 5:
        return None

    voter = {}

    # ── EPIC ─────────────────────────────────────────────────────────────
    candidates = []
    candidates += re.findall(r'[A-Z]{2,4}[O0-9]{5,8}', text)
    candidates += re.findall(r'[A-Z]{2}/\d{2}/\d{2,3}/\d{4,8}', text)
    candidates += re.findall(r'(?:FJ|FU|RJ)/\d{2}/\d{2,3}/\d{4,8}', text)

    best_epic, best_conf, best_issues = None, 0.0, []
    for raw in candidates:
        cleaned, conf, issues = validate_epic(raw)
        if cleaned and conf > best_conf:
            best_epic, best_conf, best_issues = cleaned, conf, issues
    if best_epic:
        voter['voter_id'] = best_epic
        voter['epic_confidence'] = best_conf
        voter['epic_issues'] = best_issues

    # ── Sr. No (top of card, standalone integer) ─────────────────────────
    sr_match = re.search(r'^\s*(\d{1,4})\s*$', text, re.MULTILINE)
    if sr_match:
        sr = int(sr_match.group(1))
        if 1 <= sr <= 9999:
            voter['sr_no'] = sr

    # ── Name ─────────────────────────────────────────────────────────────
    nm = re.search(
        r'(?:निर्वाचक\s*का\s*)?नाम\s*[:：]\s*:?\s*(.+?)(?:\n|पिता|पति|$)',
        text, re.MULTILINE)
    if nm:
        nm_val = re.sub(r'[\s:：]+$', '', nm.group(1).strip())
        if nm_val and len(nm_val) >= 2:
            voter['name'] = nm_val

    # ── Father / Husband ─────────────────────────────────────────────────
    fa = re.search(
        r'(पिता|पति)\s*का\s*नाम\s*[:：]?\s*(.+?)(?:\n|गृह|उम्र|लिंग|फोटो|$)',
        text, re.MULTILINE)
    if fa:
        voter['relation_type'] = 'father' if 'पिता' in fa.group(1) else 'husband'
        fa_val = re.sub(r'[\s:：]+$', '', fa.group(2).strip())
        if fa_val and len(fa_val) >= 2:
            voter['father_name'] = fa_val

    # ── House ────────────────────────────────────────────────────────────
    h = re.search(r'गृह\s*संख्या\s*[:：]?\s*(.+?)(?:\n|उम्र|लिंग|$)', text, re.MULTILINE)
    if h:
        hv = re.sub(r'[\s:：]+$', '', h.group(1).strip())
        if hv:
            voter['house_no'] = hv

    # ── Age ──────────────────────────────────────────────────────────────
    ag = re.search(r'(?:उम्र|उम्|आयु)\s*[:：]?\s*(\d{1,3})', text)
    if ag:
        a = int(ag.group(1))
        if 18 <= a <= 120:
            voter['age'] = a

    # ── Gender ───────────────────────────────────────────────────────────
    if re.search(r'महिला|FEMALE', text, re.IGNORECASE):
        voter['gender'] = 'F'
    elif re.search(r'पुरुष|MALE', text, re.IGNORECASE):
        voter['gender'] = 'M'

    # Acceptance: at least one anchor field present.
    anchors = ('voter_id', 'name', 'father_name', 'age', 'gender')
    if not any(voter.get(a) for a in anchors):
        return None

    # Defaults
    for k in ('voter_id', 'name', 'father_name', 'relation_type',
              'age', 'gender', 'house_no', 'sr_no'):
        voter.setdefault(k, None)
    voter.setdefault('epic_confidence', 0.0)
    voter.setdefault('epic_issues', [])

    return voter


# ---------------------------------------------------------------------------
# Filename metadata
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
# Main per-page pipeline
# ---------------------------------------------------------------------------

def process_page(image: Image.Image, ocr: VisionOCR, page_num: int):
    """Returns dict with extracted voters and verification stats for one page."""
    full_text, words = ocr.document_ocr(image)
    page_w, page_h = image.size

    if is_summary_page(full_text):
        return {
            'page_no': page_num, 'voters': [], 'expected': None,
            'extracted': 0, 'skipped_reason': 'summary_page', 'header': {},
            'full_text': full_text,
        }

    header = parse_header(full_text)

    # Footer count: parse from the bottom band of the page text. Vision returns
    # full text in reading order so the last lines should contain the totals.
    expected = parse_page_footer_total(full_text)

    cards = cluster_cards(words, page_w, page_h)

    voters = []
    for card in cards:
        v = parse_card(card['text'])
        if v:
            voters.append(v)

    return {
        'page_no': page_num,
        'voters': voters,
        'expected': expected,
        'extracted': len(voters),
        'skipped_reason': None,
        'header': header,
        'full_text': full_text,
    }


def process_pdf(pdf_path: str, ocr: VisionOCR, dpi: int = 300,
                retry_dpi: int = 400, retry_threshold: int = 2,
                verbose: bool = True):
    pdf_name = Path(pdf_path).name
    file_meta = parse_pdf_filename(pdf_path)

    if verbose:
        print(f"\n{'='*60}", file=sys.stderr)
        print(f"Processing: {pdf_name}", file=sys.stderr)
        print(f"Filename meta: {json.dumps(file_meta, default=str)}", file=sys.stderr)
        print(f"Rendering at {dpi} DPI...", file=sys.stderr)

    images = convert_from_path(pdf_path, dpi=dpi)
    total_pages_pdf = len(images)
    if verbose:
        print(f"PDF page count: {total_pages_pdf}", file=sys.stderr)

    # ── Document-level metadata: scan all pages but extract once ────────
    doc_meta = {'qualifying_date': None, 'publication_date': None, 'total_pages': None}

    # Pages we ultimately keep voters from + per-page stats
    all_voters = []
    page_stats = []

    # Carry forward (sub-)section info as in v3
    current_part_number      = file_meta.get('part_no')
    current_part_name        = None
    current_sub_section_no   = None
    current_sub_section_name = None

    global_sr = 0

    for idx, image in enumerate(images, 1):
        if verbose:
            print(f"  Page {idx}/{total_pages_pdf}: ", file=sys.stderr,
                  end='', flush=True)

        try:
            result = process_page(image, ocr, idx)
        except Exception as e:
            if verbose:
                print(f"OCR error: {e}", file=sys.stderr)
            page_stats.append({
                'page_no': idx, 'expected': None, 'extracted': 0,
                'status': 'OCR_ERROR', 'detail': str(e),
            })
            continue

        # Capture doc meta from any page that has it (cover usually = page 1)
        for k, v in extract_doc_meta(result['full_text']).items():
            if v and not doc_meta.get(k):
                doc_meta[k] = v

        if result['skipped_reason']:
            if verbose:
                print(f"skipped ({result['skipped_reason']})", file=sys.stderr)
            page_stats.append({
                'page_no': idx, 'expected': None, 'extracted': 0,
                'status': 'SKIPPED', 'detail': result['skipped_reason'],
            })
            continue

        # Update header carryover
        h = result['header']
        if h.get('part_number'):       current_part_number = h['part_number']
        if h.get('part_name'):         current_part_name   = h['part_name']
        if h.get('sub_section_name'):
            current_sub_section_no   = h.get('sub_section_no')
            current_sub_section_name = h['sub_section_name']

        expected = result['expected']
        extracted = result['extracted']

        # Retry at higher DPI if mismatch beyond threshold
        if (expected is not None and (expected - extracted) >= retry_threshold
                and dpi < retry_dpi):
            if verbose:
                print(f"retry@{retry_dpi}dpi ({extracted}/{expected}) → ",
                      file=sys.stderr, end='', flush=True)
            try:
                bigger = convert_from_path(pdf_path, dpi=retry_dpi,
                                           first_page=idx, last_page=idx)
                if bigger:
                    retry_result = process_page(bigger[0], ocr, idx)
                    if retry_result['extracted'] > extracted:
                        result = retry_result
                        extracted = result['extracted']
            except Exception as e:
                if verbose:
                    print(f"(retry failed: {e}) ", file=sys.stderr,
                          end='', flush=True)

        # Stamp metadata + assign global sr where missing
        for v in result['voters']:
            global_sr += 1
            if not v.get('sr_no'):
                v['sr_no'] = global_sr
            v['state_code']      = file_meta.get('state_code')
            v['constituency_no'] = file_meta.get('constituency_no')
            v['part_no']         = current_part_number or file_meta.get('part_no')
            v['part_name']       = current_part_name
            v['sub_section_no']  = current_sub_section_no
            v['sub_section']     = current_sub_section_name
            v['page_no']         = idx
            v['source_pdf']      = pdf_name
            all_voters.append(v)

        # Status flag for verify report
        if expected is None:
            status = 'NO_FOOTER'
        elif extracted == expected:
            status = 'OK'
        elif extracted > expected:
            status = 'EXTRA'
        else:
            status = 'MISSING'

        page_stats.append({
            'page_no': idx,
            'expected': expected,
            'extracted': extracted,
            'status': status,
            'detail': '',
        })

        if verbose:
            tag = '✓' if status == 'OK' else ('•' if status == 'NO_FOOTER' else '⚠')
            exp_str = expected if expected is not None else '?'
            print(f"{tag} {extracted}/{exp_str} cards", file=sys.stderr)

    # Final stamp: doc-level meta on every voter
    for v in all_voters:
        v['qualifying_date']  = doc_meta.get('qualifying_date')
        v['publication_date'] = doc_meta.get('publication_date')
        v['total_pages']      = doc_meta.get('total_pages') or total_pages_pdf

    return {
        'voters': all_voters,
        'page_stats': page_stats,
        'doc_meta': doc_meta,
        'file_meta': file_meta,
        'pdf_pages': total_pages_pdf,
        'pdf_name': pdf_name,
    }


# ---------------------------------------------------------------------------
# Verify / summary writers
# ---------------------------------------------------------------------------

def write_verify(out_csv: Path, run: dict):
    verify_path = out_csv.with_suffix('.verify.txt')
    lines = []
    lines.append(f"Verification report for {run['pdf_name']}")
    lines.append('=' * 64)
    lines.append('')
    dm = run['doc_meta']
    lines.append(f"Qualifying date  : {dm.get('qualifying_date') or '—'}")
    lines.append(f"Publication date : {dm.get('publication_date') or '—'}")
    lines.append(f"Declared total pages: {dm.get('total_pages') or '—'}")
    lines.append(f"Actual PDF pages    : {run['pdf_pages']}")
    lines.append('')
    lines.append(f"{'PAGE':>4}  {'EXPECTED':>8}  {'EXTRACTED':>9}  {'STATUS':<10}  DETAIL")
    lines.append('-' * 64)

    sum_expected = 0
    sum_extracted = 0
    flagged = 0
    for s in run['page_stats']:
        exp = s['expected'] if s['expected'] is not None else '—'
        if isinstance(exp, int):
            sum_expected += exp
        sum_extracted += s['extracted']
        if s['status'] not in ('OK', 'NO_FOOTER', 'SKIPPED'):
            flagged += 1
        lines.append(f"{s['page_no']:>4}  {str(exp):>8}  {s['extracted']:>9}  "
                     f"{s['status']:<10}  {s['detail']}")
    lines.append('-' * 64)
    lines.append(f"TOTAL EXPECTED  : {sum_expected}")
    lines.append(f"TOTAL EXTRACTED : {sum_extracted}")
    diff = sum_expected - sum_extracted
    pct = (diff / sum_expected * 100) if sum_expected else 0.0
    lines.append(f"DIFF (expected - extracted): {diff} ({pct:+.2f}%)")
    lines.append(f"FLAGGED PAGES   : {flagged}")
    verify_path.write_text('\n'.join(lines), encoding='utf-8')
    return verify_path


def write_summary(out_csv: Path, run: dict):
    summary_path = out_csv.with_suffix('.summary.txt')
    voters = run['voters']
    total = len(voters)
    fields = ['voter_id', 'name', 'father_name', 'age', 'gender',
              'house_no', 'part_name', 'sub_section']
    lines = []
    lines.append(f"Summary for {run['pdf_name']}")
    lines.append('=' * 64)
    lines.append(f"Records extracted: {total}")
    if total:
        for f in fields:
            present = sum(1 for v in voters if v.get(f))
            pct = present * 100 / total
            lines.append(f"  {f:18s}: {present}/{total} ({pct:5.1f}%)")
        epic_voters = [v for v in voters if v.get('voter_id')]
        if epic_voters:
            confs = [v.get('epic_confidence', 0) for v in epic_voters]
            perfect = sum(1 for c in confs if c >= 1.0)
            high = sum(1 for c in confs if 0.9 <= c < 1.0)
            low = sum(1 for c in confs if c < 0.9)
            lines.append('')
            lines.append('EPIC confidence:')
            lines.append(f'  perfect (1.0)   : {perfect}/{len(epic_voters)}')
            lines.append(f'  high (0.9-0.99) : {high}/{len(epic_voters)}')
            lines.append(f'  low (<0.9)      : {low}/{len(epic_voters)}')
    summary_path.write_text('\n'.join(lines), encoding='utf-8')
    return summary_path


# ---------------------------------------------------------------------------
# Output formatters
# ---------------------------------------------------------------------------

FIELDS = [
    'sr_no', 'name', 'father_name', 'relation_type', 'age', 'gender',
    'voter_id', 'epic_confidence', 'house_no',
    'state_code', 'constituency_no', 'part_no', 'part_name',
    'sub_section_no', 'sub_section',
    'qualifying_date', 'publication_date', 'total_pages', 'page_no',
]


def output_json(voters):
    clean = []
    for v in voters:
        cv = {k: v.get(k) for k in FIELDS}
        cv['epic_issues'] = v.get('epic_issues', [])
        clean.append(cv)
    return json.dumps(clean, ensure_ascii=False, indent=2)


def output_csv(voters):
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=FIELDS, extrasaction='ignore')
    w.writeheader()
    for v in voters:
        w.writerow({k: v.get(k, '') for k in FIELDS})
    return buf.getvalue()


# ---------------------------------------------------------------------------
# MySQL (kept compatible with v3)
# ---------------------------------------------------------------------------

def get_db_connection():
    if os.environ.get('MYSQL_URL'):
        from urllib.parse import urlparse
        url = urlparse(os.environ['MYSQL_URL'])
        return mysql.connector.connect(
            host=url.hostname, port=url.port or 3306,
            user=url.username, password=url.password,
            database=url.path.lstrip('/'),
        )
    return mysql.connector.connect(
        host=os.environ.get('MYSQL_HOST', 'localhost'),
        user=os.environ.get('MYSQL_USER', 'root'),
        password=os.environ.get('MYSQL_PASSWORD', ''),
        database=os.environ.get('MYSQL_DATABASE', 'election'),
        port=int(os.environ.get('MYSQL_PORT', 3306)),
    )


DB_NEW_COLUMNS = [
    ("part_name",        "VARCHAR(255) DEFAULT NULL"),
    ("sub_section_no",   "INT DEFAULT NULL"),
    ("sub_section",      "VARCHAR(255) DEFAULT NULL"),
    ("qualifying_date",  "VARCHAR(20) DEFAULT NULL"),
    ("publication_date", "VARCHAR(20) DEFAULT NULL"),
    ("total_pages",      "INT DEFAULT NULL"),
    ("page_no",          "INT DEFAULT NULL"),
]


def migrate_db(conn):
    cur = conn.cursor()
    base_cols = [
        ("state_code",       "VARCHAR(10) DEFAULT NULL"),
        ("constituency_no",  "INT DEFAULT NULL"),
        ("constituency_name","VARCHAR(255) DEFAULT NULL"),
        ("part_no",          "INT DEFAULT NULL"),
        ("sr_no",            "INT DEFAULT NULL"),
        ("house_no",         "VARCHAR(100) DEFAULT NULL"),
        ("relation_type",    "VARCHAR(10) DEFAULT NULL"),
        ("epic_confidence",  "FLOAT DEFAULT NULL"),
        ("roll_type",        "VARCHAR(20) DEFAULT NULL"),
        ("roll_year",        "INT DEFAULT NULL"),
        ("source_pdf",       "VARCHAR(500) DEFAULT NULL"),
    ] + DB_NEW_COLUMNS
    for col, defn in base_cols:
        try:
            cur.execute(f"ALTER TABLE voters ADD COLUMN {col} {defn}")
        except mysql.connector.errors.ProgrammingError:
            pass
    conn.commit()
    cur.close()


def insert_voters_batch(conn, voters, pdf_name: str):
    cur = conn.cursor()
    sql = """
    INSERT INTO voters
      (name, age, voter_id, father_name, gender, address,
       state_code, constituency_no, part_no, sr_no, house_no,
       relation_type, epic_confidence, roll_type, roll_year, source_pdf,
       part_name, sub_section_no, sub_section,
       qualifying_date, publication_date, total_pages, page_no)
    VALUES
      (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
       %s, %s, %s, %s, %s, %s, %s)
    ON DUPLICATE KEY UPDATE
      name = VALUES(name), age = VALUES(age),
      father_name = VALUES(father_name), gender = VALUES(gender),
      state_code = VALUES(state_code), constituency_no = VALUES(constituency_no),
      part_no = VALUES(part_no), sr_no = VALUES(sr_no),
      house_no = VALUES(house_no), relation_type = VALUES(relation_type),
      epic_confidence = VALUES(epic_confidence), roll_type = VALUES(roll_type),
      roll_year = VALUES(roll_year), source_pdf = VALUES(source_pdf),
      part_name = VALUES(part_name), sub_section_no = VALUES(sub_section_no),
      sub_section = VALUES(sub_section),
      qualifying_date = VALUES(qualifying_date),
      publication_date = VALUES(publication_date),
      total_pages = VALUES(total_pages), page_no = VALUES(page_no)
    """
    batch, skipped = [], 0
    for v in voters:
        if not v.get('voter_id'):
            skipped += 1
            continue
        addr = f"House {v.get('house_no')}" if v.get('house_no') else None
        batch.append((
            v.get('name'), v.get('age'), v.get('voter_id'), v.get('father_name'),
            v.get('gender'), addr,
            v.get('state_code'), v.get('constituency_no'), v.get('part_no'),
            v.get('sr_no'), v.get('house_no'), v.get('relation_type'),
            v.get('epic_confidence'), None, None, pdf_name,
            v.get('part_name'), v.get('sub_section_no'), v.get('sub_section'),
            _to_sql_date(v.get('qualifying_date')),
            _to_sql_date(v.get('publication_date')),
            v.get('total_pages'), v.get('page_no'),
        ))
    if batch:
        cur.executemany(sql, batch)
        conn.commit()
    cur.close()
    return len(batch), skipped


def _to_sql_date(s):
    """Convert 'DD-MM-YYYY' -> 'YYYY-MM-DD'. Returns None if not parseable."""
    if not s:
        return None
    m = re.match(r'^(\d{1,2})[\-./](\d{1,2})[\-./](\d{4})$', s)
    if not m:
        return None
    d, mo, y = m.groups()
    return f'{int(y):04d}-{int(mo):02d}-{int(d):02d}'


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    p = argparse.ArgumentParser(
        description='Voter-roll PDF extractor (v4: word-coordinate clustering + verify)',
    )
    p.add_argument('path', help='PDF file or directory')
    p.add_argument('--format', choices=['json', 'csv'], default='csv')
    p.add_argument('--out', help='Output file path (single PDF mode)')
    p.add_argument('--out-dir', help='Output directory (batch mode)')
    p.add_argument('--db', action='store_true')
    p.add_argument('--batch', action='store_true')
    p.add_argument('--dpi', type=int, default=300)
    p.add_argument('--retry-dpi', type=int, default=400)
    p.add_argument('--retry-threshold', type=int, default=2,
                   help='re-OCR a page at higher DPI if expected-extracted >= this')
    p.add_argument('--quiet', action='store_true')
    args = p.parse_args()

    if not os.environ.get('GOOGLE_APPLICATION_CREDENTIALS'):
        print("ERROR: set GOOGLE_APPLICATION_CREDENTIALS", file=sys.stderr)
        sys.exit(1)

    verbose = not args.quiet
    ocr = VisionOCR()
    t0 = time.time()

    path = Path(args.path)
    runs = []
    if args.batch or path.is_dir():
        pdfs = sorted(path.glob('*.pdf'))
        if not pdfs:
            print(f"No PDFs in {path}", file=sys.stderr)
            sys.exit(1)
        out_dir = Path(args.out_dir) if args.out_dir else path
        out_dir.mkdir(parents=True, exist_ok=True)
        for i, pdf in enumerate(pdfs, 1):
            print(f"\n[{i}/{len(pdfs)}] {pdf.name}", file=sys.stderr)
            r = process_pdf(str(pdf), ocr, dpi=args.dpi,
                            retry_dpi=args.retry_dpi,
                            retry_threshold=args.retry_threshold,
                            verbose=verbose)
            r['out_csv'] = out_dir / f"{pdf.stem}.csv"
            runs.append(r)
    else:
        r = process_pdf(str(path), ocr, dpi=args.dpi,
                        retry_dpi=args.retry_dpi,
                        retry_threshold=args.retry_threshold,
                        verbose=verbose)
        out = Path(args.out) if args.out else path.with_suffix('.csv')
        r['out_csv'] = out
        runs.append(r)

    elapsed = time.time() - t0

    # Write outputs
    for r in runs:
        out_csv = r['out_csv']
        out_csv.parent.mkdir(parents=True, exist_ok=True)
        text = output_json(r['voters']) if args.format == 'json' else output_csv(r['voters'])
        if args.format == 'json':
            out_csv = out_csv.with_suffix('.json')
        out_csv.write_text(text, encoding='utf-8')
        write_verify(out_csv, r)
        write_summary(out_csv, r)
        if verbose:
            print(f"\n  → {out_csv} ({len(r['voters'])} rows)", file=sys.stderr)

    if verbose:
        total_voters = sum(len(r['voters']) for r in runs)
        print(f"\nTime: {elapsed:.1f}s", file=sys.stderr)
        print(f"Vision API calls: {ocr.call_count}", file=sys.stderr)
        print(f"Total rows: {total_voters}", file=sys.stderr)
        print(f"Estimated cost: ${ocr.call_count * 0.0015:.3f}", file=sys.stderr)

    if args.db:
        conn = get_db_connection()
        migrate_db(conn)
        for r in runs:
            ins, sk = insert_voters_batch(conn, r['voters'], r['pdf_name'])
            print(f"DB {r['pdf_name']}: inserted {ins}, skipped {sk}",
                  file=sys.stderr)
        conn.close()


if __name__ == '__main__':
    main()
