#!/usr/bin/env python3
"""
Parse Indian Election Voter Roll PDFs (Hindi) and extract voter data.
Detects the grid structure on each page and OCRs individual voter card cells.

Usage:
  python3 parse-voter-pdf.py <pdf_path> [--output json|csv] [--out-file <path>]
"""

import sys
import re
import json
import csv
import io
import argparse
import numpy as np
from pdf2image import convert_from_path
import pytesseract
from PIL import Image


def detect_grid(image):
    """Detect the grid lines on a voter roll page and return cell bounding boxes."""
    arr = np.array(image.convert('L'))
    h, w = arr.shape

    # Find horizontal grid lines (rows where >40% pixels are dark)
    row_dark = (arr < 128).mean(axis=1)
    grid_rows = np.where(row_dark > 0.4)[0]

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
    grid_cols = np.where(col_dark > 0.4)[0]

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

    # Build row boundaries: pair horizontal lines
    # Lines alternate: top_border, bottom_border, top_border, bottom_border...
    rows = []
    for i in range(0, len(h_lines) - 1, 2):
        rows.append((h_lines[i], h_lines[i + 1]))

    # Build 3 columns from vertical lines
    # The voter roll has 3 columns. Each column has internal vertical lines
    # (text area border + photo area border). The leftmost v_line is the
    # page left border, the rightmost is the page right border.
    # Strategy: use the outermost v_lines as page bounds, divide into 3 cols
    left_edge = v_lines[0]
    right_edge = v_lines[-1]
    total_w = right_edge - left_edge

    # Find the two column separators (gaps between columns ~20px wide)
    # They appear where two v_lines are close together in the middle region
    separators = []
    for i in range(1, len(v_lines)):
        gap = v_lines[i] - v_lines[i - 1]
        pos = (v_lines[i - 1] + v_lines[i]) // 2
        # Separator is a small gap (~20px) between columns (not within a column)
        if 10 < gap < 50 and pos > left_edge + total_w * 0.2 and pos < right_edge - total_w * 0.2:
            separators.append(pos)

    if len(separators) >= 2:
        # Use the two most distinct separators at ~1/3 and ~2/3 positions
        target1 = left_edge + total_w / 3
        target2 = left_edge + 2 * total_w / 3
        sep1 = min(separators, key=lambda s: abs(s - target1))
        sep2 = min(separators, key=lambda s: abs(s - target2))
        cols = [(left_edge, sep1), (sep1, sep2), (sep2, right_edge)]
    else:
        # Fallback: equal thirds
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
            # Add small padding inside the borders
            pad = 5
            cells.append((
                col_left + pad,
                row_top + pad,
                col_right - pad,
                row_bottom - pad
            ))

    return cells


def ocr_cell(image, bbox):
    """Crop and OCR a single voter card cell."""
    cell = image.crop(bbox)
    if cell.width < 10 or cell.height < 10:
        return ""
    # Scale up 2x for better OCR
    cell = cell.resize((cell.width * 2, cell.height * 2), Image.LANCZOS)
    text = pytesseract.image_to_string(cell, lang='hin+eng', config='--psm 6')
    return text


def clean_voter_id(raw_id):
    """Clean and normalize voter ID strings."""
    if not raw_id:
        return None
    vid = raw_id.strip().replace(' ', '').replace('|', '/')
    match = re.search(r'([A-Z]{2,3}[/\d]{5,20}|[A-Z]{2,3}\d{5,10})', vid, re.IGNORECASE)
    if match:
        return match.group(1).upper()
    return None


def parse_cell_text(text):
    """Parse OCR text from a single voter card cell into a voter record."""
    if not text or len(text.strip()) < 10:
        return None

    # Must have voter name marker
    if 'निर्वाचक' not in text and 'नाम' not in text:
        return None

    voter = {}

    # Extract voter name
    name_match = re.search(r'(?:निर्वाचक\s*का\s*)?नाम\s*:\s*:?\s*(.+)', text, re.MULTILINE)
    if name_match:
        name = name_match.group(1).strip()
        name = re.sub(r'[:\s]+$', '', name)
        # Stop at relation keywords
        name = re.split(r'\s*(?:पिता|पति)\s*', name)[0].strip()
        if not name or len(name) < 2:
            return None
        voter['name'] = name
    else:
        return None

    # Extract father/husband name
    father_match = re.search(r'(पिता|पति)\s*का\s*नाम\s*:?\s*(.+)', text, re.MULTILINE)
    if father_match:
        voter['relation'] = 'पिता' if 'पिता' in father_match.group(1) else 'पति'
        fname = father_match.group(2).strip()
        fname = re.split(r'\s*(?:गृह|उम्र|लिंग|फोटो|निर्वाचक)', fname)[0].strip()
        fname = re.sub(r'[:\s]+$', '', fname)
        voter['father_name'] = fname if fname else None

    # Extract age
    age_match = re.search(r'उम्र\s*:?\s*(\d{1,3})', text)
    if age_match:
        age = int(age_match.group(1))
        if 1 <= age <= 150:
            voter['age'] = age

    # Extract gender
    if re.search(r'महिला', text):
        voter['gender'] = 'F'
    elif re.search(r'पुरुष', text):
        voter['gender'] = 'M'

    # Extract house number
    house_match = re.search(r'गृह\s*संख्या\s*:?\s*(.+)', text, re.MULTILINE)
    if house_match:
        hno = house_match.group(1).strip()
        hno = re.split(r'\s*(?:उम्र|लिंग|फोटो|निर्वाचक|०)', hno)[0].strip()
        hno = re.sub(r'[:\s]+$', '', hno)
        voter['house_no'] = hno if hno else None

    # Extract voter ID — appears as alphanumeric code in the cell
    # Patterns: RJ/18/138/429508, WFX090788, FHR282466
    vid_patterns = [
        r'([A-Z]{2}[/]\d{2}[/]\d{2,3}[/]\d{4,8})',  # RJ/18/138/429508
        r'([A-Z]{3}\d{5,10})',                          # WFX090788
        r'([A-Z]{2,3}[/\d]{8,15})',                     # mixed format
    ]
    for pat in vid_patterns:
        vid_match = re.search(pat, text, re.IGNORECASE)
        if vid_match:
            vid = clean_voter_id(vid_match.group(1))
            if vid and len(vid) >= 8:
                voter['voter_id'] = vid
                break

    return voter


def process_pdf(pdf_path, skip_pages=None):
    """Process entire PDF and return list of voter records."""
    if skip_pages is None:
        skip_pages = {1, 2}

    print(f"Converting PDF to images (300 DPI)...", file=sys.stderr)
    images = convert_from_path(pdf_path, dpi=300)
    print(f"Total pages: {len(images)}", file=sys.stderr)

    all_voters = []
    sr_no = 0

    for page_num, image in enumerate(images, 1):
        if page_num in skip_pages:
            print(f"  Page {page_num}: skipped (header)", file=sys.stderr)
            continue

        print(f"  Page {page_num}: ", file=sys.stderr, end='', flush=True)

        cells = detect_grid(image)
        if not cells:
            print("no grid detected, skipping", file=sys.stderr)
            continue

        print(f"{len(cells)} cells, ", file=sys.stderr, end='', flush=True)

        page_voters = []
        for bbox in cells:
            text = ocr_cell(image, bbox)
            voter = parse_cell_text(text)
            if voter:
                sr_no += 1
                voter['sr_no'] = sr_no
                voter.setdefault('voter_id', None)
                voter.setdefault('father_name', None)
                voter.setdefault('relation', None)
                voter.setdefault('age', None)
                voter.setdefault('gender', None)
                voter.setdefault('house_no', None)
                page_voters.append(voter)

        all_voters.extend(page_voters)
        print(f"found {len(page_voters)} voters", file=sys.stderr)

    return all_voters


def main():
    parser = argparse.ArgumentParser(description='Parse Indian Election Voter Roll PDF')
    parser.add_argument('pdf_path', help='Path to the voter roll PDF file')
    parser.add_argument('--output', choices=['json', 'csv'], default='json', help='Output format')
    parser.add_argument('--out-file', help='Output file path (default: stdout)')
    parser.add_argument('--skip-pages', help='Comma-separated page numbers to skip (default: 1,2)', default='1,2')
    args = parser.parse_args()

    skip = set(int(x.strip()) for x in args.skip_pages.split(',') if x.strip())
    voters = process_pdf(args.pdf_path, skip_pages=skip)

    total = len(voters)
    print(f"\nTotal voters extracted: {total}", file=sys.stderr)
    if total > 0:
        stats = {
            'voter_id': sum(1 for v in voters if v.get('voter_id')),
            'age': sum(1 for v in voters if v.get('age')),
            'gender': sum(1 for v in voters if v.get('gender')),
            'father_name': sum(1 for v in voters if v.get('father_name')),
        }
        for field, count in stats.items():
            print(f"  {field}: {count}/{total} ({count*100//total}%)", file=sys.stderr)

    if args.output == 'json':
        output = json.dumps(voters, ensure_ascii=False, indent=2)
    else:
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=['sr_no', 'name', 'father_name', 'relation', 'age', 'gender', 'voter_id', 'house_no'])
        writer.writeheader()
        writer.writerows(voters)
        output = buf.getvalue()

    if args.out_file:
        with open(args.out_file, 'w', encoding='utf-8') as f:
            f.write(output)
        print(f"Output written to: {args.out_file}", file=sys.stderr)
    else:
        print(output)


if __name__ == '__main__':
    main()
