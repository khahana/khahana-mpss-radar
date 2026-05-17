-- MPSS Radar — Supabase Schema
-- Paste this into Supabase SQL Editor and run

-- ============ RAW ITEMS ============
-- Every scraped item lands here first
CREATE TABLE IF NOT EXISTS raw_items (
  id BIGSERIAL PRIMARY KEY,
  source_id TEXT NOT NULL,        -- e.g. "zes", "maritime_exec", "google_alert_1"
  source_type TEXT NOT NULL,      -- "rss", "web_scrape", "google_alert", "manual"
  external_id TEXT,                -- unique ID from source if available
  title TEXT NOT NULL,
  url TEXT,
  content_snippet TEXT,
  published_at TIMESTAMP WITH TIME ZONE,
  scraped_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  raw_metadata JSONB,
  scored BOOLEAN DEFAULT FALSE,
  UNIQUE(source_id, external_id)
);

CREATE INDEX idx_raw_items_scored ON raw_items(scored);
CREATE INDEX idx_raw_items_published ON raw_items(published_at DESC);

-- ============ SCORED ITEMS ============
-- After Claude processes them
CREATE TABLE IF NOT EXISTS scored_items (
  id BIGSERIAL PRIMARY KEY,
  raw_item_id BIGINT REFERENCES raw_items(id) ON DELETE CASCADE,
  relevance_score INTEGER NOT NULL CHECK (relevance_score >= 0 AND relevance_score <= 100),
  category TEXT NOT NULL,         -- "competition", "synergy", "regulatory", "project_lead", "market_trend", "content_opportunity"
  priority TEXT NOT NULL,         -- "critical", "high", "medium", "low"
  related_entities TEXT[],         -- ["zes", "dewa", "neom"]
  strategic_angle TEXT,            -- 1-2 sentence why-it-matters
  recommended_action TEXT,         -- "linkedin_post", "outreach", "watch", "strategic_alert", "tender_pursuit"
  action_status TEXT DEFAULT 'new', -- "new", "actioned", "dismissed", "archived"
  user_notes TEXT,
  scored_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  actioned_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_scored_priority ON scored_items(priority, relevance_score DESC);
CREATE INDEX idx_scored_status ON scored_items(action_status);
CREATE INDEX idx_scored_category ON scored_items(category);

-- ============ LINKEDIN DRAFTS ============
CREATE TABLE IF NOT EXISTS drafts (
  id BIGSERIAL PRIMARY KEY,
  scored_item_id BIGINT REFERENCES scored_items(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  tone TEXT NOT NULL,              -- "technical_neutral", "personal_authoritative"
  hook TEXT,                       -- the opening line
  body TEXT NOT NULL,
  cta TEXT,                        -- call-to-action / dialogue invite
  hashtags TEXT[],
  status TEXT DEFAULT 'draft',     -- "draft", "edited", "published", "archived"
  generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  published_at TIMESTAMP WITH TIME ZONE,
  linkedin_url TEXT,
  performance_notes TEXT
);

CREATE INDEX idx_drafts_status ON drafts(status, generated_at DESC);

-- ============ WATCHLIST (for UI editing) ============
-- Mirrors config/watchlist.json but editable from UI
CREATE TABLE IF NOT EXISTS watchlist (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,       -- "competitor", "prospect", "regulator", "trade_press", "theme"
  entity_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT,                   -- sub-category like "fleet_electrification"
  country TEXT,
  priority TEXT,                   -- "critical", "high", "medium", "low"
  website TEXT,
  linkedin_company TEXT,
  rss_url TEXT,
  notes TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_seen_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_watchlist_type ON watchlist(entity_type, is_active);

-- ============ SCRAPE LOG ============
-- Track each scrape run for diagnostics
CREATE TABLE IF NOT EXISTS scrape_log (
  id BIGSERIAL PRIMARY KEY,
  scraper TEXT NOT NULL,           -- "rss-scraper", "web-scraper", "google-alerts"
  source_id TEXT,
  items_found INTEGER DEFAULT 0,
  items_new INTEGER DEFAULT 0,
  errors TEXT,
  duration_ms INTEGER,
  ran_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_scrape_log_ran ON scrape_log(ran_at DESC);

-- ============ VIEWS for the UI ============

-- Morning Brief view: top items from last 24h, unactioned
CREATE OR REPLACE VIEW v_morning_brief AS
SELECT
  s.id AS scored_id,
  s.priority,
  s.relevance_score,
  s.category,
  s.strategic_angle,
  s.recommended_action,
  s.related_entities,
  s.action_status,
  r.title,
  r.url,
  r.content_snippet,
  r.published_at,
  r.scraped_at,
  r.source_id
FROM scored_items s
JOIN raw_items r ON r.id = s.raw_item_id
WHERE s.action_status IN ('new')
  AND r.scraped_at >= NOW() - INTERVAL '48 hours'
ORDER BY
  CASE s.priority
    WHEN 'critical' THEN 1
    WHEN 'high' THEN 2
    WHEN 'medium' THEN 3
    WHEN 'low' THEN 4
  END,
  s.relevance_score DESC,
  r.scraped_at DESC;

-- Content opportunities view
CREATE OR REPLACE VIEW v_content_opportunities AS
SELECT
  s.id AS scored_id,
  s.strategic_angle,
  s.category,
  s.related_entities,
  r.title,
  r.url,
  r.content_snippet,
  r.published_at
FROM scored_items s
JOIN raw_items r ON r.id = s.raw_item_id
WHERE s.recommended_action = 'linkedin_post'
  AND s.action_status = 'new'
  AND r.scraped_at >= NOW() - INTERVAL '7 days'
ORDER BY s.relevance_score DESC;

-- ============ ROW LEVEL SECURITY (basic, for anon access) ============
-- We're keeping this simple: anon read-only on views, service_role full access
ALTER TABLE raw_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE scored_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE scrape_log ENABLE ROW LEVEL SECURITY;

-- Allow anon to read (UI uses anon key)
CREATE POLICY "anon read raw_items" ON raw_items FOR SELECT TO anon USING (true);
CREATE POLICY "anon read scored_items" ON scored_items FOR SELECT TO anon USING (true);
CREATE POLICY "anon read drafts" ON drafts FOR SELECT TO anon USING (true);
CREATE POLICY "anon read watchlist" ON watchlist FOR SELECT TO anon USING (true);
CREATE POLICY "anon read scrape_log" ON scrape_log FOR SELECT TO anon USING (true);

-- Allow anon to update action_status and user_notes on scored_items (for UI marking)
CREATE POLICY "anon update scored action" ON scored_items FOR UPDATE TO anon
  USING (true) WITH CHECK (true);

-- Allow anon to update drafts (edit and mark as published)
CREATE POLICY "anon update drafts" ON drafts FOR UPDATE TO anon
  USING (true) WITH CHECK (true);

-- Note: service_role bypasses RLS, so scrapers and scorer can write freely.
