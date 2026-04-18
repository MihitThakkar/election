# Election Campaign Management App — Full Prompt

> This is the exact prompt/idea that was used to build this entire application from scratch.

---

## Problem Statement

A friend is contesting a local election. He has **300+ towns/wards** to cover, with approximately **70,000 total voters**. Only voters aged **18 to 35** are eligible to vote. The voting process requires each voter to **record a video** on a separate government application stating who they are voting for.

Currently, the entire operation is managed **manually on paper** — voter lists are printed, teams are assigned areas on paper, and progress is tracked by hand. This is extremely inefficient and error-prone at scale.

**The goal is to build a digital system that replaces this entire paper-based workflow.**

---

## What the System Should Do

### 1. Role-Based Access System

The system needs **two main roles**:

- **Super Admin** (up to 304 people) — These are the campaign leaders who manage everything. They should have full access to all data, all areas, all workers, and all analytics.
- **Field Worker** — These are the ground-level team members who go door-to-door and convince voters. They should only see their own assigned voter list and their own progress.

A **Super Admin panel** should be created (either a separate page or built into the app) where:
- Only Super Admins can access role management
- Super Admins can see everyone below them in the hierarchy
- Super Admins can assign voter lists to workers

### 2. Team Hierarchy & Management

The Super Admin will create a team structure:
- Assign each worker to a specific **town/area**
- Give each worker a **list of voters** they need to visit
- Workers can **add sub-workers** under themselves, and all votes collected by sub-workers count under the parent worker's stats

Example: If Worker A has 2 sub-workers (B and C), and B collects 20 votes, those 20 votes also show in Worker A's total.

### 3. Voter List Management

- The voter data will come as an **Excel file or PDF** (one-time upload)
- The system should **parse the uploaded file** and import voter records
- Automatically **filter and identify voters aged 18-35** as eligible
- Allow assigning voter lists to specific workers, either individually or by area

### 4. Field Worker Workflow

When a field worker logs in (using their **phone number**):
1. They see **only their assigned voter list**
2. For each voter, they can mark the status:
   - **White (Pending)** — Not yet visited
   - **Green (Done)** — Vote has been successfully cast
   - **Red (Refused)** — Person refused to vote
3. The moment a worker marks a voter as "Done", it should:
   - Turn **green** on everyone's screen who has access to that list
   - Count in that worker's personal stats
   - Show up in the Super Admin's dashboard

### 5. Shared Lists Between Workers

If an area is assigned to **3-4 workers** working on the same voter list:
- All of them see the same list
- Whoever **marks a voter first** gets the credit (vote counts under their name)
- The status change (green/red) is visible to **all workers** on that shared list
- This prevents duplicate work

### 6. Super Admin Dashboard

The Super Admin should see a comprehensive dashboard with:
- **Area-wise voter statistics** — Click on any area to see assigned workers and their data
- **Worker-wise statistics** — Click on any worker to see their full data
- **Today's total votes** collected across all areas
- **All-time total votes** collected
- **Top performers** — Who collected the most votes today
- **Which area** has the highest vote collection
- **Real-time progress tracking** with visual charts

### 7. Global Search

A search feature accessible to all users where:
- Search by **voter name** or **Voter ID**
- Results show: Who is this voter assigned to? Have they voted yet? Which area are they in?

### 8. Notifications / Messaging

- Super Admin can **broadcast messages** to all field workers at once
- Can also send messages to **workers in a specific area only**
- Messages appear as **push notifications** for anyone who has the app installed
- In-app notification inbox for workers to read messages

### 9. Video Guide Section

In the **hamburger menu**, there should be a "Video Guide" section where:
- Admins can **upload recorded videos** showing voters how to cast their vote
- The video demonstrates: "This is how you record your vote on the government app — say 'Main [Candidate Name] ko vote deta/deti hu'"
- Field workers can **show these videos to voters** during their door-to-door visits

### 10. Security Requirements

- No voter data should leak through URLs or any other means
- Role-based access control — each person sees only what they're authorized to see
- Secure authentication (JWT tokens)
- Activity logging for audit trail

### 11. Login System

- Simple **phone number + password** based login
- No OTP needed for the prototype (can be added later)
- Each user is created by the Super Admin with their phone number

---

## Technical Requirements

- Should work as a **web application** (responsive for both mobile and desktop)
- Can optionally be wrapped as a **PWA (Progressive Web App)** so it installs on phones like a native app
- Should run **locally for testing** with sample data pre-loaded
- The entire team should be able to test all features through a single shared link

---

## Summary

Build a complete **Election Campaign Field Operations Management System** with:
- Phone-based login
- Super Admin panel for managing teams, areas, voter lists, and analytics
- Field worker mobile-friendly panel for marking voter status
- Excel upload for voter lists with automatic age filtering
- Hierarchical team structure with sub-worker support
- Real-time shared list updates
- Global voter search
- Broadcast notifications
- Video guide uploads for voter education
- Comprehensive dashboard with charts and statistics
- Full security with role-based access control

The app should be production-ready in design but runnable locally for immediate testing.

---

*This prompt was used to build the Election Manager application using React + Node.js + SQLite.*
