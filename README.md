# 🗳️ Election Campaign Field Operations Manager

A full-stack web application for managing election campaigns with 300+ wards, 70,000+ voters, and 300+ field workers.

## Quick Start

```bash
# 1. Start the server (backend serves built frontend on one port)
cd backend && node server.js
# → Open http://localhost:4000
```

## Development Mode (with hot reload)

```bash
# Terminal 1 — Backend
cd backend && npm run dev

# Terminal 2 — Frontend
cd frontend && npm run dev
# → Open http://localhost:3000
```

## Test Credentials

| Role | Name | Phone | Password |
|---|---|---|---|
| Super Admin | Rajesh Kumar | 9999999001 | admin123 |
| Super Admin | Sunil Sharma | 9999999002 | admin123 |
| Field Worker | Amit Singh | 8888888001 | worker123 |
| Field Worker | Deepak Yadav | 8888888002 | worker123 |
| Sub-Worker | Rahul Chauhan | 7777777001 | worker123 |

## Share with Team (no deployment needed)

```bash
npx localtunnel --port 4000
# → Get a public URL like https://xxx.loca.lt
```

## Reset Database

```bash
rm backend/election.db
# Restart server — fresh seed data will be loaded
```

## Tech Stack

- **Frontend**: React 18 + Vite + TailwindCSS + Recharts
- **Backend**: Node.js + Express.js
- **Database**: SQLite (better-sqlite3)
- **Auth**: JWT (7-day expiry) + bcrypt

## Features

- Phone + password login for all users
- Super Admin dashboard with real-time charts
- Team hierarchy (workers → sub-workers)
- Excel/CSV voter list import with age filtering (18-35)
- Real-time voter status tracking (Pending/Done/Refused)
- Shared voter lists — see what co-workers are doing
- Global voter search (name, EPIC ID, phone)
- Broadcast notifications to all or specific area workers
- Video guide uploads for voter education
- Full audit log of all activity
