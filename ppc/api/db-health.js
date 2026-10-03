import { timingSafeEqual } from 'node:crypto';

const checks = [
  ['settings', 'id'],
  ['line_parts', 'part_code'],
  ['purchase_orders', 'id'],
];

function authorized(header, secret) {
  if (typeof header !== 'string') return false;
  const actual = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return res.status(503).json({ ok: false, error: 'cron_not_configured' });
  }
  if (!authorized(req.headers.authorization, secret)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  // Reuse the existing public credentials; this route needs no service-role key.
  const baseUrl = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!baseUrl || !key) {
    return res.status(503).json({ ok: false, error: 'database_not_configured' });
  }
  let root;
  try {
    root = new URL(baseUrl);
    if (root.protocol !== 'https:') throw new Error('invalid_url');
  } catch {
    return res.status(503).json({ ok: false, error: 'database_not_configured' });
  }

  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    // Three tiny, uncached reads per daily invocation. Business data is not modified.
    for (const [table, column] of checks) {
      const url = new URL(`/rest/v1/${table}`, root);
      url.searchParams.set('select', column);
      url.searchParams.set('limit', '1');
      const headers = { apikey: key, Accept: 'application/json' };
      // Modern publishable keys are API keys, not JWT bearer tokens.
      if (!key.startsWith('sb_publishable_')) {
        headers.Authorization = `Bearer ${key}`;
      }
      const response = await fetch(url, {
        method: 'GET', headers, cache: 'no-store',
        redirect: 'error', signal: controller.signal,
      });
      if (!response.ok) throw new Error('database_unavailable');
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error('invalid_database_response');
      // Empty optional tables are valid; the singleton settings row must exist.
      if (table === 'settings' && !rows.some(row => row?.id === 1)) {
        throw new Error('settings_unavailable');
      }
    }
    const result = {
      ok: true, database: 'reachable', checks: checks.length,
      checkedAt: new Date().toISOString(), durationMs: Date.now() - started,
    };
    console.info('db_health', JSON.stringify(result));
    return res.status(200).json(result);
  } catch {
    console.error('db_health', JSON.stringify({
      ok: false, error: 'database_unavailable',
      checkedAt: new Date().toISOString(), durationMs: Date.now() - started,
    }));
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  } finally {
    clearTimeout(timeout);
  }
}
