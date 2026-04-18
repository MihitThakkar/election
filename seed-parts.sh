#!/bin/bash
# Seed parts data to the live election app
APP_URL="https://election-app-iota.vercel.app"

TOKEN=$(curl -s "$APP_URL/api/auth/login" \
  -X POST -H "Content-Type: application/json" \
  -d '{"phone":"9999999001","password":"admin123"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")

curl -s "$APP_URL/api/parts/seed" \
  -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @/Users/himanshukakrecha/Downloads/election-app/parts-data.json | python3 -m json.tool
