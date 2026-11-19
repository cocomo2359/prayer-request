# 🕊️ Prayer Wall

A small, friendly prayer-request app for a Christian cell group (10–12 people), with a bright, game-like dashboard (streaks, weekly goal, leaderboard, celebrations).

**Live app:** https://cocomo2359.github.io/prayer-request/

## How it's built

| Part | Choice | Cost |
|---|---|---|
| App screens | Plain HTML/CSS/JavaScript in `public/`, hosted on **GitHub Pages** | Free |
| Database | **Supabase** (hosted PostgreSQL) | Free plan |
| Rules & security | Database functions in `supabase/schema.sql` | — |

The browser only holds Supabase's *public* key. That key cannot read or change any table directly; it can only call the functions in `supabase/schema.sql`, and each function checks who is logged in and what they are allowed to do. Passwords are stored as bcrypt hashes.

> Supabase's free plan pauses a project after about a week with no activity. If that happens, open the Supabase dashboard and click **Restore** — no data is lost.

## Features

| # | Feature | How it works |
|---|---|---|
| 1 | Login & register | The **first person to register becomes the System Admin**. Everyone else signs up with the **cell invite code**, or is added by an admin with the default password `p@ssw0rd` (they must change it on first login). Anyone can change their password under **Profile**. |
| 2 | Manage members | **Members** page (admins): share or renew the invite code, add members, reset a forgotten password back to `p@ssw0rd`, remove members who have left, make someone else an admin. |
| 3 | Prayer requests | Any member can post a request with a title, category and details. |
| 4 | Owner-only changes | Only the person who posted a request can edit, delete, or mark it answered (with a praise report). Enforced in the database. |
| 5 | Pray for others | Every member can add a written prayer to any request, and remove their own. |
| ✨ | Dashboard | Verse of the day, 🔥 prayer streak, weekly goal, "this week's intercessors" leaderboard, filters, confetti for answered prayers. Works well on phones. |

## Setting it up (one time)

1. **Create a Supabase project** — sign up free at https://supabase.com, click **New project**, pick a region close to your cell, and wait for it to finish.
2. **Create the database** — in the project, open **SQL Editor → New query**, paste the whole of `supabase/schema.sql`, and click **Run**. (Safe to run again after updates.)
3. **Connect the app** — open **Project Settings → API Keys** (or the **Connect** button) and copy the **Project URL** and the **publishable** key (`sb_publishable_…`, or the legacy `anon` key). Put them in `public/config.js`, then commit and push.
   ⚠️ Never use the `secret` / `service_role` key.
4. **Open the app** — GitHub Actions publishes `public/` to GitHub Pages on every push to `main`. Visit the live link and register: the first account becomes the System Admin.

## Running locally

```bash
npm start
```

Opens a preview at http://localhost:8080 (uses the same Supabase project as `public/config.js`).

## Project layout

```
public/
  index.html       app shell
  app.js           all screens (login, register, dashboard, request, members, profile)
  api.js           calls the Supabase database functions
  config.js        your Supabase URL + publishable key
  styles.css       the chunky, colourful look
supabase/
  schema.sql       tables, security rules and all app logic
.github/workflows/
  pages.yml        publishes public/ to GitHub Pages
dev-server.js      local preview server
```
