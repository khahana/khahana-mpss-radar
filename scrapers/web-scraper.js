#!/usr/bin/env node
/**
 * MPSS Radar — Web Scraper
 * Scrapes news/press release pages of competitor websites.
 * Uses Cheerio for HTML parsing. No browser, no JS execution.
 *
 * Run by GitHub Actions daily, or locally:
 *   node scrapers/web-scraper.js
 */

const cheerio = require('cheerio');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const watchlistPath = path.join(__dirname, '..', 'config', 'watchlist.json');
const watchlist = JSON.parse(fs.readFileSync(watchlistPath, 'utf8'));

// ============ SITE-SPECIFIC SELECTORS ============
// Each competitor site has its own HTML structure. We define selectors per site.
// If a site fails, log it and keep going — partial data is better than no data.
const SCRAPERS = {
  zes: {
    url: 'https://zeroemissionservices.nl/en/news/',
    item: 'article, .news-item, .post',
    title: 'h2, h3, .title',
    link: 'a',
    snippet: 'p, .excerpt'
  },
  atlas_copco: {
    url: 'https://www.atlascopco.com/en-us/news-and-stories',
    item: '.tile, article, .card',
    title: 'h2, h3, .title',
    link: 'a',
    snippet: 'p, .text'
  },
  aggreko: {
    url: 'https://www.aggreko.com/en/insights',
    item: 'article, .card, .news-item',
    title: 'h2, h3',
    link: 'a',
    snippet: 'p'
  },
  northvolt: {
    url: 'https://northvolt.com/articles',
    item: 'article, .post-card',
    title: 'h2, h3',
    link: 'a',
    snippet: 'p'
  },
  wartsila_es: {
    url: 'https://www.wartsila.com/media/news',
    item: 'article, .news-item',
    title: 'h2, h3',
    link: 'a',
    snippet: 'p'
  },
  masdar: {
    url: 'https://masdar.ae/en/news/newsroom',
    item: 'article, .news-card',
    title: 'h2, h3',
    link: 'a',
    snippet: 'p'
  }
};

// ============ HELPERS ============
async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; MPSS-Radar/1.0; KhahanA Insights market intelligence)'
    },
    redirect: 'follow'
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function absoluteUrl(baseUrl, href) {
  if (!href) return null;
  try { return new URL(href, baseUrl).toString(); }
  catch { return null; }
}

async function logRun(scraper, source_id, items_found, items_new, errors, duration_ms) {
  try {
    await supabase.from('scrape_log').insert({
      scraper, source_id, items_found, items_new, errors, duration_ms
    });
  } catch (e) { console.error('Log failed:', e.message); }
}

// ============ MAIN ============
async function scrapeSite(id, config, name) {
  const start = Date.now();
  console.log(`\n→ ${name} (${config.url})`);

  try {
    const html = await fetchHtml(config.url);
    const $ = cheerio.load(html);
    const items = [];

    $(config.item).each((_, el) => {
      const $el = $(el);
      const title = $el.find(config.title).first().text().trim();
      const linkRel = $el.find(config.link).first().attr('href');
      const link = absoluteUrl(config.url, linkRel);
      const snippet = $el.find(config.snippet).first().text().trim().slice(0, 400);

      if (title && title.length > 10) {
        items.push({ title, link, snippet });
      }
    });

    // Dedupe by title within run
    const seen = new Set();
    const unique = items.filter(i => {
      if (seen.has(i.title)) return false;
      seen.add(i.title);
      return true;
    }).slice(0, 30); // cap per site

    console.log(`  Found ${unique.length} items`);

    let newCount = 0;
    for (const item of unique) {
      const row = {
        source_id: id,
        source_type: 'web_scrape',
        external_id: item.link || item.title,
        title: item.title.slice(0, 500),
        url: item.link,
        content_snippet: item.snippet,
        published_at: null,
        raw_metadata: { source_name: name, scraper: 'cheerio' }
      };

      const { error } = await supabase
        .from('raw_items')
        .upsert(row, { onConflict: 'source_id,external_id', ignoreDuplicates: true });

      if (!error || !error.message.includes('duplicate')) {
        if (!error) newCount++;
      }
    }

    await logRun('web-scraper', id, unique.length, newCount, null, Date.now() - start);
    console.log(`  ✓ ${newCount} new items inserted`);
    return { found: unique.length, new: newCount };

  } catch (err) {
    console.error(`  ✗ Failed: ${err.message}`);
    await logRun('web-scraper', id, 0, 0, err.message, Date.now() - start);
    return { found: 0, new: 0, error: err.message };
  }
}

async function main() {
  console.log('========================================');
  console.log('MPSS Radar — Web Scraper');
  console.log('========================================');
  console.log(`Run started: ${new Date().toISOString()}`);

  const allCompetitors = [
    ...(watchlist.competitors.direct_mobile_bess || []),
    ...(watchlist.competitors.regional_mea || [])
  ];

  let totalFound = 0;
  let totalNew = 0;

  for (const [id, config] of Object.entries(SCRAPERS)) {
    const entity = allCompetitors.find(c => c.id === id);
    const name = entity ? entity.name : id;
    const result = await scrapeSite(id, config, name);
    totalFound += result.found || 0;
    totalNew += result.new || 0;
    await new Promise(r => setTimeout(r, 2000)); // 2s between sites
  }

  console.log('\n========================================');
  console.log(`Done. ${totalFound} items found, ${totalNew} new.`);
  console.log('========================================');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
