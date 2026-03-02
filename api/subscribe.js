// api/subscribe.js
// Saves the browser's push subscription to Vercel KV store

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const subscription = req.body;
    if (!subscription?.endpoint) {
      return res.status(400).json({ error: 'Invalid subscription' });
    }

    // Store subscription in Vercel KV
    const { kv } = await import('@vercel/kv');
    // Use endpoint hash as key so each device gets its own entry
    const key = `sub_${Buffer.from(subscription.endpoint).toString('base64').slice(0, 32)}`;
    await kv.set(key, JSON.stringify(subscription));
    await kv.sadd('all_subscriptions', key);

    console.log('Subscription saved:', key);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Subscribe error:', err);
    return res.status(500).json({ error: err.message });
  }
}
