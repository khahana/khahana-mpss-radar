#!/usr/bin/env node
/**
 * MPSS Radar v2.0 — Watchlist Seeder
 * Loads config/watchlist.json (v2 flat-array format with region tags) into Supabase.
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

// Competitors (flat array in v2)
for (const c of (watchlist.competitors || [])) {
  rows.push({
    entity_type: 'competitor',
    entity_id: c.id,
    name: c.name,
    category: c.subcategory,
    subcategory: c.subcategory,
    country: c.country,
    region: c.region,
    priority: c.priority,
    website: c.website,
    linkedin_company: c.linkedin_company,
    notes: (c.products || []).join('; '),
    is_active: true
  });
}

// Prospects (flat array in v2)
for (const p of (watchlist.prospects || [])) {
  rows.push({
    entity_type: 'prospect',
    entity_id: p.id,
    name: p.name,
    category: p.subcategory,
    subcategory: p.subcategory,
    country: p.country,
    region: p.region,
    priority: p.priority,
    website: p.website,
    linkedin_company: p.linkedin_company,
    notes: p.notes || null,
    is_active: true
  });
}

// Regulators
for (const r of (watchlist.regulators || [])) {
  rows.push({
    entity_type: 'regulator',
    entity_id: r.id,
    name: r.name,
    country: r.country,
    region: r.region,
    priority: r.priority,
    website: r.website,
    is_active: true
  });
}

// Trade press
for (const t of (watchlist.trade_press || [])) {
  rows.push({
    entity_type: 'trade_press',
    entity_id: t.id,
    name: t.name,
    region: t.region,
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
    region: 'Global',
    priority: 'medium',
    is_active: true
  });
});

async function seed() {
  console.log(`Seeding ${rows.length} watchlist entries (v2 global)...`);

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

  // Region summary
  const summary = {};
  rows.forEach(r => {
    const key = `${r.entity_type}/${r.region || 'unknown'}`;
    summary[key] = (summary[key] || 0) + 1;
  });
  console.log('\nDistribution:');
  Object.keys(summary).sort().forEach(k => console.log(`  ${k}: ${summary[k]}`));
  console.log('\nDone.');
}

seed().catch(err => { console.error(err); process.exit(1); });
