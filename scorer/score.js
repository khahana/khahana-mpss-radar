#!/usr/bin/env node
/**
 * MPSS Radar v2.0 — Scoring Agent (region-aware)
 * Reads unscored items, scores via Claude, writes results including region tag,
 * generates content drafts for high-relevance items.
 */

const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || !ANTHROPIC_API_KEY) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_KEY, or ANTHROPIC_API_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const SCORING_PROMPT = fs.readFileSync(path.join(__dirname, 'prompts', 'scoring-prompt.md'), 'utf8');
const CONTENT_PROMPTS = fs.readFileSync(path.join(__dirname, 'prompts', 'content-prompts.md'), 'utf8');

const SCORING_MODEL = 'claude-haiku-4-5-20251001';
const CONTENT_MODEL = 'claude-sonnet-4-6';

async function scoreItem(item) {
  const userMessage = `Score this item for MPSS BD relevance.

Source: ${item.source_id} (${item.source_type})
Title: ${item.title}
URL: ${item.url || 'n/a'}
Snippet: ${item.content_snippet || '(no snippet)'}
Published: ${item.published_at || 'unknown'}`;

  try {
    const response = await anthropic.messages.create({
      model: SCORING_MODEL,
      max_tokens: 600,
      system: SCORING_PROMPT,
      messages: [{ role: 'user', content: userMessage }]
    });

    const text = response.content[0].text.trim();
    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const scored = JSON.parse(cleaned);

    if (typeof scored.relevance_score !== 'number') throw new Error('Missing relevance_score');
    if (!scored.category) throw new Error('Missing category');
    if (!scored.priority) throw new Error('Missing priority');
    if (!scored.region) scored.region = 'Global'; // safety default

    return scored;
  } catch (err) {
    console.error(`  Score error: ${err.message}`);
    return null;
  }
}

async function generateContent(scoredItem, rawItem, tone) {
  const userMessage = `Tone: ${tone}
Region focus: ${scoredItem.region}
Source title: ${rawItem.title}
Source URL: ${rawItem.url || 'n/a'}
Source snippet: ${rawItem.content_snippet || ''}
Strategic angle: ${scoredItem.strategic_angle}
Related entities: ${(scoredItem.related_entities || []).join(', ')}

Generate the post.`;

  try {
    const response = await anthropic.messages.create({
      model: CONTENT_MODEL,
      max_tokens: 1500,
      system: CONTENT_PROMPTS,
      messages: [{ role: 'user', content: userMessage }]
    });

    const text = response.content[0].text.trim();
    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const draft = JSON.parse(cleaned);
    if (!draft.body) throw new Error('Missing body');
    return draft;
  } catch (err) {
    console.error(`  Content error: ${err.message}`);
    return null;
  }
}

async function main() {
  console.log('========================================');
  console.log('MPSS Radar v2 — Scoring Agent');
  console.log('========================================');
  console.log(`Run started: ${new Date().toISOString()}`);

  const { data: items, error } = await supabase
    .from('raw_items')
    .select('*')
    .eq('scored', false)
    .order('scraped_at', { ascending: false })
    .limit(100);

  if (error) { console.error('Fetch error:', error); process.exit(1); }
  console.log(`\nItems to score: ${items.length}`);

  let scored = 0, drafted = 0, dismissed = 0;
  const regionCounts = { EMEA: 0, Americas: 0, APAC: 0, Global: 0 };

  for (const item of items) {
    console.log(`\n→ ${item.title.slice(0, 80)}`);
    const result = await scoreItem(item);

    if (!result) {
      await supabase.from('raw_items').update({ scored: true }).eq('id', item.id);
      continue;
    }

    const { data: scoredRow, error: scoredErr } = await supabase
      .from('scored_items')
      .insert({
        raw_item_id: item.id,
        relevance_score: result.relevance_score,
        category: result.category,
        priority: result.priority,
        region: result.region,
        related_entities: result.related_entities || [],
        strategic_angle: result.strategic_angle,
        recommended_action: result.recommended_action,
        action_status: result.recommended_action === 'dismiss' ? 'dismissed' : 'new'
      })
      .select()
      .single();

    if (scoredErr) { console.error('  Insert scored error:', scoredErr.message); continue; }

    await supabase.from('raw_items').update({ scored: true }).eq('id', item.id);
    scored++;
    regionCounts[result.region] = (regionCounts[result.region] || 0) + 1;
    console.log(`  ✓ Scored ${result.relevance_score} (${result.priority}) [${result.region}] — ${result.category}`);

    if (result.recommended_action === 'dismiss') { dismissed++; continue; }

    if (result.recommended_action === 'linkedin_post' && result.relevance_score >= 70) {
      console.log('  → generating drafts (both tones)...');
      for (const tone of ['technical_neutral', 'personal_authoritative']) {
        const draft = await generateContent(scoredRow, item, tone);
        if (!draft) continue;
        const { error: draftErr } = await supabase.from('drafts').insert({
          scored_item_id: scoredRow.id,
          title: draft.title || item.title.slice(0, 60),
          tone,
          hook: draft.hook,
          body: draft.body,
          cta: draft.cta,
          hashtags: draft.hashtags || []
        });
        if (!draftErr) drafted++;
      }
    }
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n========================================');
  console.log(`Done. Scored: ${scored}, Drafted: ${drafted}, Dismissed: ${dismissed}`);
  console.log(`By region: EMEA ${regionCounts.EMEA}, Americas ${regionCounts.Americas}, APAC ${regionCounts.APAC}, Global ${regionCounts.Global}`);
  console.log('========================================');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
