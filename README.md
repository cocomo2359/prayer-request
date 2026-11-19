# 🕊️ Prayer Wall

A small, friendly prayer-request app for a Christian cell group (10–12 people), with a bright, game-like dashboard (streaks, weekly goal, leaderboard, celebrations).

## Quick start

Requires **Node.js 22.13+** (uses the built-in `node:sqlite`, so there's no database to install).

```bash
npm install
```

```bash
npm start
```

Open http://localhost:8080. The **first person to register becomes the System Admin**. Everyone else signs up on **Create an account** with the **cell invite code**, which admins see on the **Members** page (with a button to copy an invite message for your cell chat).

## Features

| # | Requirement | How it works |
|---|---|---|
| 1 | Login & register | Members sign up themselves with the cell invite code and choose their own password. Members added by an admin start with `p@ssw0rd` and must change it on first login (the server blocks everything else until they do). Anyone can change their password later under **Profile**. |
| 2 | Add cell members | **Members** page. The System Admin shares or renews the invite code, adds members directly (default password), resets a member's forgotten password back to `p@ssw0rd`, removes members who have left the cell, and can make another member an admin. Everyone else sees the member list. |
| 3 | Add a prayer request | **New Request** page: title, category, details. |
| 4 | Owner-only edit / delete / mark answered | Only the person who posted a request sees the buttons, and the server rejects anyone else (HTTP 403). Marking "answered" lets the owner add a praise report; they can also re-open it. |
| 5 | Others pray for a request | Every member can add a written prayer on any request. Members can remove their own prayers. |
| ✨ | Duolingo-style dashboard | Verse of the day, 🔥 prayer streak, weekly goal bar, "This week's intercessors" leaderboard, filters (All / Praying / Answered / Mine), confetti when a prayer is answered. Works on phones with a bottom nav bar. |

## Tech stack (and why)

| Layer | Choice | Why it fits a 12-person group |
|---|---|---|
| Backend | **Node.js + Express** | Tiny, well-known, one file (`server.js`). |
| Database | **SQLite** via built-in `node:sqlite` | Zero setup, a single file at `data/prayer.db`, easy to back up. Plenty for dozens of users. |
| Auth | **bcrypt** password hashes + random session tokens in an **HttpOnly cookie** | Simple and secure; sessions last 30 days, login attempts are throttled. |
| Frontend | **Vanilla JS single-page app** + CSS (Nunito font) | No build step; loads instantly on phones. |

**Hosting suggestions** (any host that keeps a persistent disk for the SQLite file):
- **Fly.io** or **Railway** with a small volume — a few dollars a month or free tier.
- A **Raspberry Pi / spare PC** at church plus Cloudflare Tunnel.
- Set `NODE_ENV=production` (marks the cookie `Secure`, requires HTTPS), `PORT`, and optionally `DATA_DIR` for where the database lives.

**If you outgrow it later**: Next.js + Supabase (Postgres + auth) or Firebase would add push notifications and email password resets, at the cost of more setup.

## Project layout

```
server.js        API routes, auth, permission checks, stats
db.js            SQLite schema + cell invite code
public/
  index.html     app shell
  app.js         all screens (login, dashboard, request, members, profile)
  styles.css     the chunky, colourful look
data/prayer.db   created on first run (back this up!)
```

## Backups

Copy `data/prayer.db` (stop the server first, or copy the `-wal` file along with it).
