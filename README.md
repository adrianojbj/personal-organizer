# Personal Organizer

A local personal organizer with Slack integration. Manage people and tasks, get notifications via Slack DMs, and track status from free-text replies.

## Features

- 👥 Manage people with their Slack user IDs
- 📌 Create tasks/projects assigned to people (or yourself)
- 🔔 Auto DM via Slack on task creation, due date, and overdue digest
- 💬 Parse free-text replies (`done`, `in progress`, `blocked`, `ack`) to update status
- 📊 Audit log of every task event
- 🌐 React web UI (no auth — single-user local app)

## Stack

Node.js + Express · SQLite (`better-sqlite3`) · React + Vite · `@slack/bolt` (Socket Mode) · `node-cron`

## Setup

### 1. Create a Slack app

1. Go to https://api.slack.com/apps → **Create New App** → From scratch.
2. **Socket Mode** → Enable. Generate an **App-Level Token** with scope `connections:write`. Save as `SLACK_APP_TOKEN` (`xapp-...`).
3. **OAuth & Permissions** → add **Bot Token Scopes**:
   - `chat:write`
   - `im:history`
   - `im:write`
   - `users:read`
4. **Event Subscriptions** → Enable Events → subscribe to bot events: `message.im`.
5. **Install to Workspace**. Save the **Bot User OAuth Token** as `SLACK_BOT_TOKEN` (`xoxb-...`).
6. Find your own Slack member ID (profile → ⋯ → Copy member ID) for `OWNER_SLACK_ID`.

### 2. Configure

```bash
cp .env.example .env
# edit .env and fill in SLACK_BOT_TOKEN, SLACK_APP_TOKEN, OWNER_SLACK_ID
```

### 3. Install & run

```bash
npm run install:all
npm run dev
```

- Web UI: http://localhost:5173
- API:    http://localhost:3001

The Slack bot connects automatically via Socket Mode (no public URL / ngrok required). If the tokens are not set, the web app still works — Slack actions just become no-ops.

### Production build

```bash
npm run build
npm start
# Single process serving API + built web at http://localhost:3001
```

## Using it

1. Open the web UI → **People** → add yourself & teammates, including their Slack member ID.
2. Go to **Tasks** → create a task, choose an assignee (or "👤 Me").
3. The assignee gets a DM:
   ```
   📌 Task #4: Ship organizer v1
   🗓️ Due: 2026-05-25
   Status: Pending
   Reply with `done`, `in progress`, `blocked`, or `ack` to update.
   ```
4. The assignee replies in DM. Keyword is parsed and status updated automatically. Anything else is stored as a comment in the audit log.
5. If they have multiple open tasks, they can target one with `#<id>` in the message (e.g. `#4 done`).

## Reminders

- **Every minute**: tasks with `due_date = today` get a one-time DM.
- **Daily 09:00 local**: overdue digest to each assignee + full open-tasks summary to the owner.

## Data

- SQLite file: `data.db` (created on first run, ignored by git).
- Tables: `people`, `tasks`, `task_events`.

## Project layout

```
server/    Express API + Slack Bolt bot + cron scheduler
web/       Vite + React frontend
```
