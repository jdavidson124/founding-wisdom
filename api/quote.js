// api/quote.js — returns today's cached quote from Upstash

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const cachedDate = await upstash('GET', 'todays_quote_date');
    if (cachedDate === new Date().toDateString()) {
      const raw = await upstash('GET', 'todays_quote');
      const quote = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return res.status(200).json({ quote, source: 'cache' });
    }
    return res.status(404).json({ error: 'No quote yet today — cron runs at 7 AM PST' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

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
  if (data.error) throw new Error(data.error);
  return data.result;
}
