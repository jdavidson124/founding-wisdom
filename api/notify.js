// api/notify.js
// Runs daily at 7 AM PST via Vercel cron (0 15 * * *)
// Fetches quote from Claude, sends push notification to all subscribers

import webpush from 'web-push';

const PEOPLE = ["John Adams","Thomas Paine","Samuel Adams","Mercy Otis Warren","Abigail Adams"];

const SYSTEM_PROMPT = `You are a historian and plain-language educator. You will be told which specific person to quote. Select a real, historically verified quote from that person only.

The quote MUST be inspirational — about personal courage, perseverance, resilience, integrity, hard work, or the human spirit. Think along the lines of Thomas Paine's "The harder the conflict, the more glorious the triumph" — quotes that fire people up or make them reflect on their own character.

Do NOT select quotes primarily about government structure, taxation, legislation, constitutions, political parties, or policy. Avoid anything that reads like a civics lesson.

Pick a lesser-known quote — not the most famous one everyone already knows.

Respond ONLY with a valid JSON object, no markdown, no backticks, no explanation:
{
  "author": "Full name",
  "quote": "The exact historical quote",
  "date": "Approximate date or year (e.g. 'December 1776' or 'c. 1772')",
  "modern": "A plain, conversational rewrite of what they meant in today's language — 2 to 4 sentences",
  "context": "2 to 3 sentences of historical context: what was happening at the time, why they said it, why it mattered"
}`;

// Upstash REST helpers — no SDK needed
async function upstash(command, ...args) {
  const res = await fetch(process.env.KV_REST_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([command, ...args])
  });
  const data = await res.json();
  if (data.error) throw new Error(`Upstash: ${data.error}`);
  return data.result;
}

async function fetchQuote() {
  const person = PEOPLE[Math.floor(Date.now() / 86400000) % PEOPLE.length];
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
      messages: [{ role: 'user', content: `Give me a real, historically verified quote from ${person}. Not their most famous — something meaningful and lesser-known.` }]
    })
  });
  if (!res.ok) throw new Error(`Claude API error: ${res.status}`);
  const data = await res.json();
  const raw = data.content.map(b => b.text || '').join('').replace(/```json|```/g, '').trim();
  return JSON.parse(raw);
}

export default async function handler(req, res) {
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const cronSecret   = process.env.CRON_SECRET;
  const authorized   = isVercelCron || !cronSecret || req.headers['authorization'] === `Bearer ${cronSecret}`;
  if (!authorized) return res.status(401).json({ error: 'Unauthorized' });

  try {
    webpush.setVapidDetails(
      'mailto:noreply@american-gazette.app',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );

    const quote = await fetchQuote();
    console.log(`Quote fetched: ${quote.author}`);

    await upstash('SET', 'todays_quote', JSON.stringify(quote));
    await upstash('SET', 'todays_quote_date', new Date().toDateString());

    const subKeys = await upstash('SMEMBERS', 'all_subscriptions') || [];
    console.log(`${subKeys.length} subscribers`);

    const payload = JSON.stringify({
      title: `American Gazette · ${quote.author}`,
      body: `"${quote.quote.substring(0, 110)}${quote.quote.length > 110 ? '…' : ''}" — Tap to read.`,
      icon: '/icon-192.png',
      tag: 'daily-quote',
      data: { quote }
    });

    let sent = 0;
    for (const key of subKeys) {
      try {
        const subStr = await upstash('GET', key);
        if (!subStr) continue;
        const sub = typeof subStr === 'string' ? JSON.parse(subStr) : subStr;
        await webpush.sendNotification(sub, payload);
        sent++;
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await upstash('DEL', key);
          await upstash('SREM', 'all_subscriptions', key);
          console.log('Removed expired sub:', key);
        }
      }
    }

    return res.status(200).json({ success: true, sent, author: quote.author });
  } catch (err) {
    console.error('Notify error:', err);
    return res.status(500).json({ error: err.message });
  }
}
