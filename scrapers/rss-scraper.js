#!/usr/bin/env node
/**
 * MPSS Radar v2.4 — RSS Scraper
 * Pulls RSS feeds, deduplicates by URL across sources, and filters out items
 * published more than 60 days ago (whether by feed pubDate or detected from title).
 *
 * Run by GitHub Actions every 12h, or locally:
 *   node scrapers/rss-scraper.js
 *
 * Env vars required:
 *   SUPABASE_URL
 *   SUPABASE_KEY  (service_role key, not anon)
 */

const Parser = require('rss-parser');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const parser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': 'MPSS-Radar/1.0' }
});

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const watchlistPath = path.join(__dirname, '..', 'config', 'watchlist.json');
const watchlist = JSON.parse(fs.readFileSync(watchlistPath, 'utf8'));

// Item must be published within this many days. Items beyond this are skipped.
const MAX_AGE_DAYS = 60;

// ============ HELPERS ============
function snippetFromContent(item) {
  const text = item.contentSnippet || item.content || item.summary || '';
  return text.replace(/\s+/g, ' ').trim().slice(0, 600);
}

function externalIdFor(item) {
  return item.guid || item.id || item.link || (item.title + (item.pubDate || ''));
}

// Normalise URL for dedup: lowercase host, strip trailing slash, drop query/fragment
function normaliseUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    let path = u.pathname;
    if (path.endsWith('/') && path.length > 1) path = path.slice(0, -1);
    return (u.hostname.toLowerCase() + path).replace(/^www\./, '');
  } catch {
    return url.toLowerCase().split('?')[0].split('#')[0].replace(/\/$/, '');
  }
}

// Check if title contains a historical year (older than 2 years ago)
function hasHistoricalYear(title, currentYear = new Date().getFullYear()) {
  if (!title) return false;
  // Match 4-digit years 1990-2099 with word boundaries
  const matches = title.match(/\b(19[9][0-9]|20[0-9]{2})\b/g);
  if (!matches) return false;
  return matches.some(y => parseInt(y, 10) < (currentYear - 1));
}

// Check if item is too old based on its pubDate
function isTooOld(item, maxAgeDays = MAX_AGE_DAYS) {
  const pubStr = item.isoDate || item.pubDate;
  if (!pubStr) return false; // unknown date — don't filter
  const pubDate = new Date(pubStr);
  if (isNaN(pubDate.getTime())) return false;
  const ageDays = (Date.now() - pubDate.getTime()) / (1000 * 60 * 60 * 24);
  return ageDays > maxAgeDays;
}

async function logRun(scraper, source_id, items_found, items_new, errors, duration_ms) {
  try {
    await supabase.from('scrape_log').insert({
      scraper,
      source_id,
      items_found,
      items_new,
      errors: errors || null,
      duration_ms,
      run_at: new Date().toISOString()
    });
  } catch (e) {
    console.error('Log error:', e.message);
  }
}

// In-memory dedup tracking for this run
const seenUrls = new Set();
let existingUrls = new Set(); // populated from DB at start

async function loadExistingUrls() {
  // Load URLs of recent items already in DB to skip them cross-source
  const { data, error } = await supabase
    .from('raw_items')
    .select('url')
    .gte('scraped_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString());
  if (error) {
    console.warn('Could not load existing URLs for dedup:', error.message);
    return;
  }
  for (const row of (data || [])) {
    const norm = normaliseUrl(row.url);
    if (norm) existingUrls.add(norm);
  }
  console.log(`Loaded ${existingUrls.size} existing URLs for dedup`);
}

async function scrapeFeed(feed) {
  const start = Date.now();
  console.log(`\n→ ${feed.name} (${feed.rss})`);

  try {
    const parsed = await parser.parseURL(feed.rss);
    const items = parsed.items || [];
    console.log(`  Fetched ${items.length} items`);

    let newCount = 0;
    let dedupedCount = 0;
    let oldCount = 0;
    let historicalCount = 0;

    for (const item of items) {
      // Filter 1: items too old by pubDate
      if (isTooOld(item)) {
        oldCount++;
        continue;
      }

      // Filter 2: items with historical years in title (e.g. "2021 ZES launch")
      if (hasHistoricalYear(item.title)) {
        historicalCount++;
        continue;
      }

      // Filter 3: URL already seen this run or already in DB
      const normUrl = normaliseUrl(item.link);
      if (normUrl) {
        if (seenUrls.has(normUrl) || existingUrls.has(normUrl)) {
          dedupedCount++;
          continue;
        }
        seenUrls.add(normUrl);
      }

      const externalId = externalIdFor(item);
      const row = {
        source_id: feed.id,
        source_type: 'rss',
        external_id: externalId,
        title: (item.title || '').trim().slice(0, 500),
        url: item.link || null,
        content_snippet: snippetFromContent(item),
        published_at: item.isoDate || item.pubDate || null,
        raw_metadata: {
          author: item.creator || item.author,
          categories: item.categories,
          feed_title: parsed.title
        }
      };

      const { error } = await supabase
        .from('raw_items')
        .upsert(row, { onConflict: 'source_id,external_id', ignoreDuplicates: true });

      if (error) {
        if (!error.message.includes('duplicate')) {
          console.error('  Insert error:', error.message);
        }
      } else {
        newCount++;
      }
    }

    await logRun('rss-scraper', feed.id, items.length, newCount, null, Date.now() - start);
    const breakdown = [];
    if (oldCount > 0) breakdown.push(`${oldCount} too old`);
    if (historicalCount > 0) breakdown.push(`${historicalCount} historical`);
    if (dedupedCount > 0) breakdown.push(`${dedupedCount} dup`);
    const breakdownStr = breakdown.length > 0 ? ` (${breakdown.join(', ')})` : '';
    console.log(`  ✓ ${newCount} new items inserted${breakdownStr}`);
    return { found: items.length, new: newCount };

  } catch (err) {
    console.error(`  ✗ Failed: ${err.message}`);
    await logRun('rss-scraper', feed.id, 0, 0, err.message, Date.now() - start);
    return { found: 0, new: 0, error: err.message };
  }
}

async function main() {
  console.log('========================================');
  console.log('MPSS Radar v2.4 — RSS Scraper');
  console.log('========================================');
  console.log(`Run started: ${new Date().toISOString()}`);
  console.log(`Max age filter: ${MAX_AGE_DAYS} days`);

  await loadExistingUrls();

  const feeds = watchlist.trade_press || [];
  console.log(`\nFeeds to process: ${feeds.length}`);

  let totalFound = 0;
  let totalNew = 0;

  for (const feed of feeds) {
    const result = await scrapeFeed(feed);
    totalFound += result.found || 0;
    totalNew += result.new || 0;
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('\n========================================');
  console.log(`Done. ${totalFound} items found, ${totalNew} new (after dedup + age filter).`);
  console.log('========================================');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
