// Vercel serverless function: stores tournaments in Upstash Redis (REST). No npm deps.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const IDS = ['fc27', 'lol'];

async function redis(cmd) {
  const r = await fetch(URL_, { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!URL_ || !TOKEN) return res.status(500).json({ error: 'Database env vars missing' });
    if (req.method === 'GET') {
      const vals = await redis(['MGET', ...IDS.map(i => 'e7s:' + i)]);
      const out = {};
      IDS.forEach((id, i) => { if (vals[i]) out[id] = JSON.parse(vals[i]); });
      return res.status(200).json(out);
    }
    const id = req.query.id;
    if (!IDS.includes(id)) return res.status(400).json({ error: 'Bad id' });
    if (req.method === 'POST') { await redis(['SET', 'e7s:' + id, JSON.stringify(req.body)]); return res.status(200).json({ ok: true }); }
    if (req.method === 'DELETE') { await redis(['DEL', 'e7s:' + id]); return res.status(200).json({ ok: true }); }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) { return res.status(500).json({ error: String(e.message || e) }); }
};
