# MPSS Radar — Setup Guide

This walks you through getting MPSS Radar running end-to-end. Estimated time: 30-45 minutes for first setup.

---

## Step 1 — Supabase (free, ~10 min)

1. Go to https://supabase.com and sign up (free, no credit card)
2. Click **New project**:
   - Name: `mpss-radar`
   - Database password: generate a strong one and save it somewhere
   - Region: pick the closest to you (Frankfurt is good for Dubai)
   - Plan: Free
3. Wait 2 minutes for provisioning
4. Once ready, go to **Project Settings → API**:
   - Copy the **Project URL** (looks like `https://xxxxx.supabase.co`)
   - Copy the **anon public** key (long string starting `eyJ...`)
   - Copy the **service_role** key (also `eyJ...`, but DIFFERENT — labeled "service_role secret")
   - Save all three somewhere safe
5. Go to **SQL Editor → New query**, paste contents of `supabase/schema.sql`, click **Run**
6. You should see "Success. No rows returned." Tables are now created.

---

## Step 2 — Anthropic API key (5 min)

1. Go to https://console.anthropic.com
2. Create or log in
3. **Settings → API Keys → Create Key**
4. Name it `mpss-radar`
5. Copy the key (starts `sk-ant-...`)
6. Save it

You'll also want to add credit to your account — $10 is more than enough for 3-6 months of running this.

---

## Step 3 — GitHub repository (5 min)

1. Create a private repo on your GitHub: `khahana-mpss-radar`
2. From your local terminal:

   ```bash
   cd /path/to/mpss-radar    # the folder this README is in
   git init
   git add .
   git commit -m "Initial MPSS Radar"
   git remote add origin git@github.com:YOUR_USERNAME/khahana-mpss-radar.git
   git branch -M main
   git push -u origin main
   ```

3. In the repo on GitHub: **Settings → Secrets and variables → Actions → New repository secret**, add three:
   - `SUPABASE_URL` = your project URL
   - `SUPABASE_KEY` = the **service_role** key (the secret one, not anon)
   - `ANTHROPIC_API_KEY` = your Anthropic key

---

## Step 4 — Seed the watchlist (one-time, ~2 min)

You need to load the watchlist entries from `config/watchlist.json` into Supabase. Two options:

### Option A — Locally on your Mac

```bash
cd /path/to/mpss-radar
npm install
export SUPABASE_URL="https://xxxxx.supabase.co"
export SUPABASE_KEY="eyJ... (service_role)"
node scripts/seed-watchlist.js
```

Should print "Seeding 99 watchlist entries..." then "Done."

### Option B — From GitHub Actions

Go to **Actions → Scrape RSS Feeds → Run workflow**. The scraper will run, but won't seed the watchlist UI table. So Option A is recommended for the one-time seed.

---

## Step 5 — Configure the local UI (2 min)

1. Open `index.html` in your browser (just double-click it)
2. Click **⚙ Config** in the top right
3. Paste:
   - Supabase Project URL
   - Supabase **anon public** key (NOT the service_role one — anon is the public-safe one for browser use)
4. Click **Save & Connect**
5. The status pill should turn green: "Connected"

If you see the watchlist when you click the **Watchlist** tab, the data layer is working.

---

## Step 6 — First scrape run (5 min)

1. In your GitHub repo, go to **Actions → Scrape RSS Feeds → Run workflow**
2. Wait 2-3 minutes for it to complete
3. Click the running workflow to see the logs
4. You should see lines like `✓ 14 new items inserted` for each feed

Then trigger the web scraper too: **Actions → Scrape Competitor Websites → Run workflow**.

After both finish, the scorer runs automatically (it's chained in the same workflow).

---

## Step 7 — Open the UI

1. Refresh `index.html`
2. You should see items in the **Morning Brief**
3. Click **Content Studio** tab — drafts should be there if any high-relevance content opportunities were found
4. Click a draft, edit it, copy to LinkedIn

---

## Daily routine

**Morning (5 min):** Open `index.html`, read Morning Brief, mark items as actioned/dismissed.

**Posting day (10 min, 2-3x/week):** Open Content Studio, pick a draft, edit, publish to LinkedIn, mark as published.

**Friday (15 min):** Review Watchlist, scan dismissed items for patterns (might need to tune the scoring prompt), add any new entities you've encountered.

---

## Troubleshooting

**No items appearing after scrape ran successfully?**
- Check `scrape_log` in Supabase Table Editor — did items insert?
- Check `raw_items` count — is it growing?
- The UI uses the `v_morning_brief` view which filters to last 48h. If items are old, they won't show.

**Scorer is dismissing too much?**
- Open `scorer/prompts/scoring-prompt.md`
- Tune the rubric (raise/lower the score thresholds)
- Commit, push, next scorer run uses the updated prompt

**RSS feeds failing?**
- Some feeds rotate URLs. Check `scrape_log` table for error messages.
- Update the URL in `config/watchlist.json`, commit, push.

**Web scrapers returning 0 items?**
- Sites change their HTML structure. The selectors in `scrapers/web-scraper.js` need updating.
- This is the highest-maintenance part of the system. Plan to tune every 2-3 months.

---

## Cost monitoring

- Supabase: should stay on free tier indefinitely at this scale
- GitHub Actions: ~50 min/month, well within 2,000 free minutes
- Anthropic API: ~$3-5/month at typical volumes. Monitor at https://console.anthropic.com/usage

---

## What's not yet wired (planned for Day 5-6 of build)

- "Generate New" button in Content Studio (currently auto-only)
- History/search view
- Watchlist editing from UI (currently read-only)
- Google Alerts inbound integration (currently theme-based searches not wired)

These are quick additions. Tell me when you want them.

---

© 2026 KhahanA Insights
