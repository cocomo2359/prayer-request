# 🕊️ Prayer Wall

A small, friendly prayer-request app for a Christian cell group (10–12 people), with a bright, game-like dashboard (streaks, weekly goal, leaderboard, celebrations).

**Live app:** https://cocomo2359.github.io/prayer-request/

🎬 **Demo video (90 s):** [media/prayer-wall-demo.mp4](media/prayer-wall-demo.mp4)

📖 **How-to guide (3 min):** [media/prayer-wall-guide.mp4](media/prayer-wall-guide.mp4): joining with the invite code, the dashboard, praying, posting and managing your requests, making your avatar, and the System Admin's tools.

## How it's built

| Part | Choice | Cost |
|---|---|---|
| App screens | Plain HTML/CSS/JavaScript in `public/`, hosted on **GitHub Pages** | Free |
| Server (API) | **Cloudflare Worker** in `worker/` | Free plan (100,000 requests/day) |
| Database | **Cloudflare D1** (SQLite) | Free plan (5 GB) |

All the rules (logins, invite code, admin-only member management, owner-only edit/delete/answer) are checked in the Worker. Passwords are stored as salted PBKDF2 hashes, sessions use random tokens, and the API only accepts calls from the GitHub Pages site. Nothing pauses when the cell is quiet.

## Features

| # | Feature | How it works |
|---|---|---|
| 1 | Login & register | The **first person to register becomes the System Admin**. Everyone else signs up with the **cell invite code** and chooses their own password. Anyone can change their password under **Profile**. |
| 2 | Manage members | **Members** page (admins): share or renew the invite code, reset a forgotten password (the admin gets a random one-time password to pass on, and the member picks a new one at login), remove members who have left, make someone else an admin. |
| 3 | Prayer requests | Any member can post a request with a title, category and details. |
| 4 | Owner-only changes | Only the person who posted a request can edit, delete, or mark it answered (with a praise report). Enforced in the database. |
| 5 | Pray for others | Every member can add a written prayer to any request, and remove their own. |
| ✨ | Dashboard | Verse of the day, 🔥 prayer streak, weekly goal, "this week's intercessors" leaderboard, filters, confetti for answered prayers. Works well on phones. |
| 🧑‍🎨 | Avatars | Each member gets a Duolingo-style cartoon character and can customise it under **Profile**: background, skin, hair style and colour, eyes, mouth, outfit and an extra (glasses, shades, cap, flower or halo), or tap **Surprise me**. |

## Setting it up (one time)

You need a free Cloudflare account (https://dash.cloudflare.com/sign-up). Then, from the `worker/` folder:

```bash
npm install
```

```bash
npx wrangler login
```

```bash
npx wrangler d1 create prayer-request-db
```

Copy the `database_id` it prints into `worker/wrangler.toml`, then create the tables and deploy:

```bash
npm run db:init:remote
```

```bash
npm run deploy
```

Put the `https://prayer-request-api.<subdomain>.workers.dev` address it prints into `public/config.js`, commit and push. GitHub Actions republishes the site; open it and register — **the first account becomes the System Admin**.

If you host the screens somewhere other than `https://cocomo2359.github.io`, add that address to `ALLOWED_ORIGINS` in `worker/wrangler.toml` and deploy again.

## Running locally

In one terminal (the API, with a local database):

```bash
cd worker && npm run db:init:local && npm run dev
```

In another (the screens):

```bash
npm start
```

Open http://localhost:8080 — on localhost the app talks to the local Worker automatically.

## Tests

The API has route tests that run on Node's built-in test runner — no extra packages:

```bash
cd worker && npm test
```

They call the Worker directly with an in-memory stand-in for D1 (built on Node's `node:sqlite`, loading `worker/schema.sql`) and print a coverage report. GitHub Actions runs them on every pull request. Requires Node 22.13 or newer.

## Project layout

```
public/              the app (published to GitHub Pages)
  index.html         app shell
  app.js             all screens (login, register, dashboard, request, members, profile)
  api.js             calls the Worker API
  config.js          the Worker's address
  styles.css         the chunky, colourful look
worker/              the API (deployed to Cloudflare)
  src/index.js       routes, auth and all the rules
  schema.sql         D1 database tables
  wrangler.toml      Cloudflare settings
  test/              route tests (npm test)
.github/workflows/
  pages.yml          publishes public/ to GitHub Pages
dev-server.js        local preview server for public/
```
