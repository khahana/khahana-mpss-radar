#!/usr/bin/env node
/**
 * MPSS Radar — Watchlist Seeder
 * Loads config/watchlist.json into the Supabase watchlist table.
 * Run once after first Supabase setup, then again whenever you edit watchlist.json.
 *
 *   node scripts/seed-watchlist.js
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_KEY (service_role)');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const watchlist = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'watchlist.json'), 'utf8'));

const rows = [];

// Competitors
for (const [bucket, list] of Object.entries(watchlist.competitors || {})) {
  for (const c of list) {
    rows.push({
      entity_type: 'competitor',
      entity_id: c.id,
      name: c.name,
      category: bucket,
      country: c.country,
      priority: c.priority,
      website: c.website,
      linkedin_company: c.linkedin_company,
      notes: (c.products || []).join('; '),
      is_active: true
    });
  }
}

// Prospects
for (const [bucket, list] of Object.entries(watchlist.prospects || {})) {
  for (const p of list) {
    rows.push({
      entity_type: 'prospect',
      entity_id: p.id,
      name: p.name,
      category: bucket,
      country: p.country,
      priority: p.priority,
      website: p.website,
      linkedin_company: p.linkedin_company,
      notes: p.notes || null,
      is_active: true
    });
  }
}

// Regulators
for (const r of watchlist.regulators || []) {
  rows.push({
    entity_type: 'regulator',
    entity_id: r.id,
    name: r.name,
    country: r.country,
    priority: r.priority,
    website: r.website,
    is_active: true
  });
}

// Trade press
for (const t of watchlist.trade_press || []) {
  rows.push({
    entity_type: 'trade_press',
    entity_id: t.id,
    name: t.name,
    priority: t.priority,
    rss_url: t.rss,
    is_active: true
  });
}

// Themes
(watchlist.themes || []).forEach((theme, i) => {
  rows.push({
    entity_type: 'theme',
    entity_id: 'theme_' + (i + 1),
    name: theme,
    priority: 'medium',
    is_active: true
  });
});

async function seed() {
  console.log(`Seeding ${rows.length} watchlist entries...`);

  // Upsert in batches of 50
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const { error } = await supabase
      .from('watchlist')
      .upsert(batch, { onConflict: 'entity_id' });
    if (error) {
      console.error('Batch error:', error.message);
    } else {
      console.log(`  ✓ Batch ${Math.floor(i / 50) + 1}/${Math.ceil(rows.length / 50)}`);
    }
  }

  console.log('\nDone.');
}

seed().catch(err => { console.error(err); process.exit(1); });
