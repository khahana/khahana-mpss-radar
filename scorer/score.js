#!/usr/bin/env node
/**
 * MPSS Radar — Scoring Agent
 * Reads unscored items from raw_items, scores each one via Claude API,
 * writes results to scored_items, generates content drafts for high-relevance items.
 *
 * Run after scrapers, by GitHub Actions, or locally:
 *   node scorer/score.js
 *
 * Env vars required:
 *   SUPABASE_URL, SUPABASE_KEY (service_role)
 *   ANTHROPIC_API_KEY
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

// ============ MODELS ============
const SCORING_MODEL = 'claude-haiku-4-5-20251001';
const CONTENT_MODEL = 'claude-sonnet-4-6';

// ============ SCORING ============
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
    // Strip code fences if model added them
    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const scored = JSON.parse(cleaned);

    // Validate required fields
    if (typeof scored.relevance_score !== 'number') throw new Error('Missing relevance_score');
    if (!scored.category) throw new Error('Missing category');
    if (!scored.priority) throw new Error('Missing priority');

    return scored;

  } catch (err) {
    console.error(`  Score error: ${err.message}`);
    return null;
  }
}

// ============ CONTENT GENERATION ============
async function generateContent(scoredItem, rawItem, tone) {
  const toneLabel = tone === 'technical_neutral' ? 'technical_neutral' : 'personal_authoritative';
  const userMessage = `Tone: ${toneLabel}
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

// ============ MAIN ============
async function main() {
  console.log('========================================');
  console.log('MPSS Radar — Scoring Agent');
  console.log('========================================');
  console.log(`Run started: ${new Date().toISOString()}`);

  // Fetch unscored items, cap at 100 per run
  const { data: items, error } = await supabase
    .from('raw_items')
    .select('*')
    .eq('scored', false)
    .order('scraped_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('Fetch error:', error);
    process.exit(1);
  }

  console.log(`\nItems to score: ${items.length}`);

  let scored = 0;
  let drafted = 0;
  let dismissed = 0;

  for (const item of items) {
    console.log(`\n→ ${item.title.slice(0, 80)}`);
    const result = await scoreItem(item);

    if (!result) {
      // Mark as scored to avoid loop; record nothing
      await supabase.from('raw_items').update({ scored: true }).eq('id', item.id);
      continue;
    }

    // Insert scored item
    const { data: scoredRow, error: scoredErr } = await supabase
      .from('scored_items')
      .insert({
        raw_item_id: item.id,
        relevance_score: result.relevance_score,
        category: result.category,
        priority: result.priority,
        related_entities: result.related_entities || [],
        strategic_angle: result.strategic_angle,
        recommended_action: result.recommended_action,
        action_status: result.recommended_action === 'dismiss' ? 'dismissed' : 'new'
      })
      .select()
      .single();

    if (scoredErr) {
      console.error('  Insert scored error:', scoredErr.message);
      continue;
    }

    // Mark raw_item as scored
    await supabase.from('raw_items').update({ scored: true }).eq('id', item.id);
    scored++;
    console.log(`  ✓ Scored ${result.relevance_score} (${result.priority}) — ${result.category}`);

    if (result.recommended_action === 'dismiss') {
      dismissed++;
      continue;
    }

    // Generate drafts for high-relevance content opportunities
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

    // Rate limit: brief pause between items
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n========================================');
  console.log(`Done. Scored: ${scored}, Drafted: ${drafted}, Dismissed: ${dismissed}`);
  console.log('========================================');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
