#!/usr/bin/env node
/**
 * MPSS Radar — RSS Scraper
 * Pulls all RSS feeds from config/watchlist.json (trade_press section)
 * and writes new items to Supabase.
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

// ============ HELPERS ============
function snippetFromContent(item) {
  const text = item.contentSnippet || item.content || item.summary || '';
  return text.replace(/\s+/g, ' ').trim().slice(0, 600);
}

function externalIdFor(item) {
  return item.guid || item.id || item.link || (item.title + (item.pubDate || ''));
}

async function logRun(scraper, source_id, items_found, items_new, errors, duration_ms) {
  try {
    await supabase.from('scrape_log').insert({
      scraper, source_id, items_found, items_new, errors, duration_ms
    });
  } catch (e) { console.error('Log failed:', e.message); }
}

// ============ MAIN ============
async function scrapeFeed(feed) {
  const start = Date.now();
  console.log(`\n→ ${feed.name} (${feed.rss})`);

  try {
    const parsed = await parser.parseURL(feed.rss);
    const items = parsed.items || [];
    console.log(`  Fetched ${items.length} items`);

    let newCount = 0;
    for (const item of items) {
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

      // Insert with upsert on (source_id, external_id)
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
    console.log(`  ✓ ${newCount} new items inserted`);
    return { found: items.length, new: newCount };

  } catch (err) {
    console.error(`  ✗ Failed: ${err.message}`);
    await logRun('rss-scraper', feed.id, 0, 0, err.message, Date.now() - start);
    return { found: 0, new: 0, error: err.message };
  }
}

async function main() {
  console.log('========================================');
  console.log('MPSS Radar — RSS Scraper');
  console.log('========================================');
  console.log(`Run started: ${new Date().toISOString()}`);

  const feeds = watchlist.trade_press || [];
  console.log(`\nFeeds to process: ${feeds.length}`);

  let totalFound = 0;
  let totalNew = 0;

  for (const feed of feeds) {
    const result = await scrapeFeed(feed);
    totalFound += result.found || 0;
    totalNew += result.new || 0;
    // Be polite: 1s between feeds
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('\n========================================');
  console.log(`Done. ${totalFound} items found, ${totalNew} new.`);
  console.log('========================================');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
