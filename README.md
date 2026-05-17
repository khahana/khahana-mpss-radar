# MPSS Radar — Market Intelligence & Content Studio

A market intelligence and LinkedIn content generation system for VDR Energy Systems MPSS business development.

**Built by KhahanA Insights**
**For Alireza Khahan, VDR BD Partner**

---

## What it does

Two integrated modules:

1. **Intelligence Monitor** — scrapes web sources every 24h and RSS feeds every 12h, scores items for MPSS relevance using Claude, and surfaces a daily Morning Brief with prioritised insights and recommended actions.

2. **Content Studio** — generates LinkedIn post drafts from the intelligence stream, in two tones (technical neutral / personal authoritative), ready for review and publication.

---

## Architecture

```
┌────────────────────────────────────────────────────────┐
│  SCRAPERS (GitHub Actions cron)                        │
│  → /scrapers/*.js                                       │
│  → Pushes to Supabase                                   │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│  SCORING AGENT (GitHub Actions, runs after scrapers)   │
│  → /scorer/score.js                                    │
│  → Uses Claude API to score, tag, recommend            │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│  STORAGE (Supabase free tier)                          │
│  → raw_items, scored_items, drafts, watchlist          │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│  LOCAL UI (open index.html in browser)                 │
│  → Reads directly from Supabase                        │
│  → Morning Brief, Content Studio, Watchlist            │
└────────────────────────────────────────────────────────┘
```

---

## File structure

```
mpss-radar/
├── README.md                    # this file
├── index.html                   # the local UI (open in browser)
├── config/
│   ├── watchlist.json           # competitors, prospects, regulators, themes
│   └── rss-feeds.json           # native RSS sources
├── scrapers/
│   ├── rss-scraper.js           # pulls all RSS feeds
│   ├── web-scraper.js           # scrapes competitor websites
│   └── google-alerts.js         # parses Google Alerts emails (via SendGrid webhook)
├── scorer/
│   ├── score.js                 # Claude-powered scoring agent
│   └── prompts/
│       ├── scoring-prompt.md    # the scoring rubric
│       └── content-prompts.md   # LinkedIn content generation
├── content/
│   └── generate.js              # content studio backend
├── .github/
│   └── workflows/
│       ├── scrape-rss.yml       # every 12h
│       ├── scrape-web.yml       # daily
│       └── score-items.yml      # runs after scrapers
└── supabase/
    └── schema.sql               # database schema
```

---

## Setup steps (one-time, ~30 minutes)

### 1. Create Supabase project
- Go to https://supabase.com, sign up (free)
- Create new project, name it "mpss-radar"
- Save the Project URL and the anon/public key
- In SQL Editor, paste contents of `supabase/schema.sql` and run

### 2. Get Claude API key
- Go to https://console.anthropic.com
- Create API key
- Save it

### 3. Fork to your GitHub
- Push this repo to your GitHub (private)
- In repo Settings → Secrets and variables → Actions, add:
  - `SUPABASE_URL`
  - `SUPABASE_KEY` (service_role key, not anon)
  - `ANTHROPIC_API_KEY`

### 4. Configure local UI
- Open `index.html` in any text editor
- Fill in `SUPABASE_URL` and `SUPABASE_ANON_KEY` at the top
- Save

### 5. Set up Google Alerts (optional but recommended)
- Create alerts at https://google.com/alerts using the queries in `config/watchlist.json` → themes
- Set delivery to email → send to a Gmail address
- Use Zapier or n8n to forward to Supabase (instructions in Day 2 doc)

### 6. Open the UI
- Double-click `index.html`
- Should open in browser with the dashboard
- Will show "No items yet" until first scraper run

### 7. Trigger first scrape
- Go to GitHub repo → Actions → "Scrape RSS" → Run workflow
- Wait 2-3 minutes
- Reload index.html
- Should see items flowing in

---

## Daily workflow

**Morning (5 minutes):**
1. Open index.html
2. Read Morning Brief
3. Mark items as: Action needed / Watch / Dismiss
4. Review Content Studio drafts

**Posting (10 minutes, 2-3x per week):**
1. Open Content Studio
2. Pick a draft
3. Edit in your voice
4. Copy to LinkedIn

**Weekly review (15 minutes, Fridays):**
1. Open Watchlist tab
2. Check what's been silent (might need manual check)
3. Add new entities as you find them
4. Tune scoring if too noisy

---

## Cost summary

- Supabase: free
- GitHub Actions: free (well under 2,000 min/mo limit)
- Claude API: ~$3-5/month based on volume
- Optional RSS.app for LinkedIn company pages: $9.99/mo (skip if Google Alerts is enough)

**Total: $3-15/month depending on choices**

---

© 2026 KhahanA Insights. Internal tool for VDR BD activities.
