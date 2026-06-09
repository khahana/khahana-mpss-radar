#!/usr/bin/env node
/**
 * MPSS Radar v3.0 — Vercel build script
 * Injects Supabase URL and ANON key into index.html from environment variables,
 * then copies to dist/ folder for static serving.
 *
 * Vercel runs this automatically via `buildCommand` in vercel.json.
 *
 * Required env vars (set in Vercel project settings → Environment Variables):
 *   - SUPABASE_URL          The Supabase project URL
 *   - SUPABASE_ANON_KEY     The anon (public) key from Supabase
 */

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('========================================');
  console.error('BUILD FAILED');
  console.error('========================================');
  console.error('Missing required environment variables:');
  if (!SUPABASE_URL) console.error('  SUPABASE_URL');
  if (!SUPABASE_ANON_KEY) console.error('  SUPABASE_ANON_KEY');
  console.error('');
  console.error('Set these in Vercel project settings → Environment Variables');
  process.exit(1);
}

console.log('Building MPSS Radar v3.0...');

// Read source HTML
const sourcePath = path.join(__dirname, 'index.html');
let html = fs.readFileSync(sourcePath, 'utf8');

// Inject environment variables before the main script tag
// This makes them available as window.SUPABASE_URL and window.SUPABASE_ANON_KEY
const injection = `
  <script>
    window.SUPABASE_URL = ${JSON.stringify(SUPABASE_URL)};
    window.SUPABASE_ANON_KEY = ${JSON.stringify(SUPABASE_ANON_KEY)};
  </script>
`;

// Insert just before </head> so window vars are defined before the main script runs
html = html.replace('</head>', injection + '</head>');

// Write to dist/
const distDir = path.join(__dirname, 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}
fs.writeFileSync(path.join(distDir, 'index.html'), html);

// Copy any other static assets if they exist
const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(publicDir)) {
  // Simple recursive copy
  function copyRecursive(src, dst) {
    if (fs.statSync(src).isDirectory()) {
      if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
      fs.readdirSync(src).forEach(f => copyRecursive(path.join(src, f), path.join(dst, f)));
    } else {
      fs.copyFileSync(src, dst);
    }
  }
  copyRecursive(publicDir, distDir);
}

console.log('✓ Built to dist/index.html');
console.log('  SUPABASE_URL injected:', SUPABASE_URL);
console.log('  SUPABASE_ANON_KEY injected: ***' + SUPABASE_ANON_KEY.slice(-6));
