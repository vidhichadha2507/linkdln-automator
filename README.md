# LinkedIn Email Automator

A tool and Chrome extension for generating corporate email addresses from LinkedIn profiles, managing outreach campaigns, tracking applications, and managing database backup/restore snapshots.

## Quick Start

1. **Setup Env File**:
   ```bash
   cp .env.example .env
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Start Database & Run Setup**:
   ```bash
   npm run docker:db
   npm run phase1:setup
   ```

4. **Start Dev Server**:
   ```bash
   npm run dev
   ```

The API/Web App runs at `http://localhost:4000`.

## Console Panels

- **Admin Console**: `http://localhost:4000/admin.html`
  - Manage Outreach Outbox, Applications Tracker, custom Templates Editor, Activity logs, and Backup/Restore snapshot recovery.

## Chrome Extension

Located in `./extension`. To load it:
1. Go to `chrome://extensions` in Google Chrome.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** (top-left).
4. Select the `./extension` folder.

## Development Commands

- **Run Tests**: `npm test`
- **Typecheck**: `npm run typecheck`
- **Database Seed**: `npm run db:seed`
