// api/quote.js
// Returns today's cached quote (fetched by the cron job)
// Falls back to fetching a new one if not yet cached

import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const cachedDate = await kv.get('todays_quote_date');
    const today = new Date().toDateString();

    if (cachedDate === today) {
      const quote = await kv.get('todays_quote');
      const parsed = typeof quote === 'string' ? JSON.parse(quote) : quote;
      return res.status(200).json({ quote: parsed, source: 'cache' });
    }

    return res.status(404).json({ error: 'No quote yet today — cron runs at 7 AM PST' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
