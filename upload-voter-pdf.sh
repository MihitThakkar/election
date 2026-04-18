#!/bin/bash
# Upload Voter Roll PDF to Election App
# Usage: ./upload-voter-pdf.sh <pdf_file> [part_number] [area_id]
#
# This script:
# 1. Extracts voter data from Hindi PDF using OCR
# 2. Converts to CSV
# 3. Uploads to the live Vercel app with part_number
#
# Requirements: python3, tesseract (with Hindi), poppler

set -e

PDF_FILE="$1"
PART_NUMBER="${2:-}"
AREA_ID="${3:-1}"
APP_URL="https://election-app-iota.vercel.app"

if [ -z "$PDF_FILE" ]; then
  echo "Usage: ./upload-voter-pdf.sh <pdf_file> [part_number] [area_id]"
  echo ""
  echo "  pdf_file     - Path to the Hindi voter roll PDF"
  echo "  part_number  - Part/booth number from the PDF (e.g., 275)"
  echo "  area_id      - Area/Ward ID to assign voters to (default: 1)"
  echo ""
  echo "Example:"
  echo "  ./upload-voter-pdf.sh voter-roll-HIN-275.pdf 275 1"
  exit 1
fi

if [ ! -f "$PDF_FILE" ]; then
  echo "Error: File not found: $PDF_FILE"
  exit 1
fi

# Try to auto-detect part_number from filename if not provided
if [ -z "$PART_NUMBER" ]; then
  PART_NUMBER=$(echo "$PDF_FILE" | grep -oE 'HIN-([0-9]+)' | head -1 | sed 's/HIN-//')
  if [ -n "$PART_NUMBER" ]; then
    echo "Auto-detected part_number: $PART_NUMBER (from filename)"
  fi
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMP_CSV="/tmp/voters_upload_$(date +%s).csv"

echo "Step 1: Extracting voters from PDF (OCR)..."
echo "  This may take a few minutes for large PDFs..."
echo ""

python3 "$SCRIPT_DIR/backend/scripts/parse-voter-pdf.py" "$PDF_FILE" --output csv --out-file "$TEMP_CSV"

# Convert to upload-ready format
UPLOAD_CSV="/tmp/voters_ready_$(date +%s).csv"
python3 -c "
import csv
with open('$TEMP_CSV') as f:
    rows = list(csv.DictReader(f))
with open('$UPLOAD_CSV', 'w', newline='', encoding='utf-8') as f:
    writer = csv.writer(f)
    writer.writerow(['name', 'age', 'voter_id', 'father_name', 'phone', 'address', 'gender'])
    for r in rows:
        gender = r.get('gender', '')
        address = f\"House {r.get('house_no', '')}\" if r.get('house_no') else ''
        writer.writerow([r.get('name',''), r.get('age',''), r.get('voter_id',''), r.get('father_name',''), '', address, gender])
print(f'  CSV ready: {len(rows)} voters')
"

echo ""
echo "Step 2: Uploading to live app..."

# Login
TOKEN=$(curl -s "$APP_URL/api/auth/login" \
  -X POST -H "Content-Type: application/json" \
  -d '{"phone":"9999999001","password":"admin123"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")

# Upload with part_number
UPLOAD_ARGS="-F \"file=@$UPLOAD_CSV\" -F \"area_id=$AREA_ID\""
if [ -n "$PART_NUMBER" ]; then
  echo "  Part number: $PART_NUMBER"
  RESULT=$(curl -s "$APP_URL/api/voters/upload" \
    -X POST -H "Authorization: Bearer $TOKEN" \
    -F "file=@$UPLOAD_CSV" \
    -F "area_id=$AREA_ID" \
    -F "part_number=$PART_NUMBER")
else
  RESULT=$(curl -s "$APP_URL/api/voters/upload" \
    -X POST -H "Authorization: Bearer $TOKEN" \
    -F "file=@$UPLOAD_CSV" \
    -F "area_id=$AREA_ID")
fi

echo "$RESULT" | python3 -c "
import sys, json
d = json.load(sys.stdin)
if d.get('success'):
    r = d['data']
    print(f'  Imported: {r[\"imported\"]} voters')
    print(f'  Skipped:  {r[\"skipped\"]} (duplicates)')
    print(f'  Eligible: {r[\"eligible\"]} (age 18-35)')
    print('')
    print('Done! View at: $APP_URL')
else:
    print(f'  Error: {d.get(\"error\", \"Unknown error\")}')
"

# Cleanup
rm -f "$TEMP_CSV" "$UPLOAD_CSV"
