// api/subscribe.js — saves push subscription to Upstash Redis

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const subscription = req.body;
    if (!subscription?.endpoint) return res.status(400).json({ error: 'Invalid subscription' });

    const key = `sub_${Buffer.from(subscription.endpoint).toString('base64').slice(0, 40).replace(/[/+=]/g, '_')}`;
    await upstashSet(key, JSON.stringify(subscription));
    await upstashSadd('all_subscriptions', key);

    console.log('Subscription saved:', key);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Subscribe error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// Lightweight Upstash REST helpers — no SDK needed
async function upstashRequest(command, ...args) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  const res = await fetch(`${url}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([command, ...args])
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

const upstashSet  = (k, v)    => upstashRequest('SET', k, v);
const upstashSadd = (k, ...v) => upstashRequest('SADD', k, ...v);
