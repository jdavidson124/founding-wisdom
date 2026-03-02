// api/notify.js
// Runs daily at 7 AM PST via Vercel cron (schedule: "0 15 * * *" = 15:00 UTC = 7 AM PST)
// Fetches a fresh quote from Claude API and pushes it to all subscribed devices

import webpush from 'web-push';
import { kv } from '@vercel/kv';

const PEOPLE = [
  "John Adams",
  "Thomas Paine",
  "Samuel Adams",
  "Mercy Otis Warren",
  "Abigail Adams"
];

const SYSTEM_PROMPT = `You are a historian and plain-language educator. You will be told which specific person to quote. Select a real, historically verified quote from that person only.

Pick a meaningful but lesser-known quote — not the most famous one everyone already knows. These are all figures from 18th century Boston and colonial America.

Respond ONLY with a valid JSON object, no markdown, no backticks, no explanation:
{
  "author": "Full name",
  "quote": "The exact historical quote",
  "date": "Approximate date or year (e.g. 'December 1776' or 'c. 1772')",
  "modern": "A plain, conversational rewrite of what they meant in today's language — 2 to 4 sentences",
  "context": "2 to 3 sentences of historical context: what was happening at the time, why they said it, why it mattered"
}`;

async function fetchQuote() {
  // Pick person based on day of year for consistent rotation
  const dayOfYear = Math.floor(Date.now() / 86400000);
  const person = PEOPLE[dayOfYear % PEOPLE.length];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Give me a real, historically verified quote from ${person}. Choose one that is meaningful but not their most famous — something that reveals their character or thinking in a fresh way.`
      }]
    })
  });

  if (!res.ok) throw new Error(`Claude API error: ${res.status}`);
  const data = await res.json();
  const raw = data.content.map(b => b.text || '').join('').replace(/```json|```/g, '').trim();
  return JSON.parse(raw);
}

export default async function handler(req, res) {
  // Allow manual trigger via GET for testing, cron uses GET too
  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;

  // Verify this is a legitimate cron call or manual trigger with secret
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    // Vercel cron jobs send the CRON_SECRET automatically
    // Also allow direct calls without secret in dev/testing
    if (req.headers['x-vercel-cron'] !== '1' && authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    // Configure web-push with VAPID keys
    webpush.setVapidDetails(
      'mailto:noreply@american-gazette.app',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );

    // Fetch today's quote from Claude
    console.log('Fetching quote from Claude...');
    const quote = await fetchQuote();
    console.log(`Got quote from ${quote.author}`);

    // Store today's quote in KV so the app can retrieve it
    await kv.set('todays_quote', JSON.stringify(quote));
    await kv.set('todays_quote_date', new Date().toDateString());

    // Get all subscriber keys
    const subKeys = await kv.smembers('all_subscriptions');
    console.log(`Sending to ${subKeys.length} subscribers`);

    const notifPayload = JSON.stringify({
      title: `American Gazette · ${quote.author}`,
      body: `"${quote.quote.substring(0, 110)}${quote.quote.length > 110 ? '…' : ''}" — Tap to read.`,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'daily-quote',
      data: { quote }
    });

    // Send to all subscribers, remove expired ones
    const results = await Promise.allSettled(
      subKeys.map(async (key) => {
        const subStr = await kv.get(key);
        if (!subStr) return;
        const subscription = typeof subStr === 'string' ? JSON.parse(subStr) : subStr;
        try {
          await webpush.sendNotification(subscription, notifPayload);
          console.log('Sent to:', key);
        } catch (err) {
          if (err.statusCode === 410 || err.statusCode === 404) {
            // Subscription expired — remove it
            await kv.del(key);
            await kv.srem('all_subscriptions', key);
            console.log('Removed expired subscription:', key);
          } else {
            throw err;
          }
        }
      })
    );

    const sent = results.filter(r => r.status === 'fulfilled').length;
    return res.status(200).json({ success: true, sent, author: quote.author });

  } catch (err) {
    console.error('Notify error:', err);
    return res.status(500).json({ error: err.message });
  }
}
