// ============================================================================
// RunFit Cloudflare Worker — backup cloud (KV)
// ----------------------------------------------------------------------------
// Endpoints:
//   POST /backup    Body: JSON profilo+sessioni        Auth: Bearer
//   GET  /backup                                       Auth: Bearer
//   GET  /health    -> 200 OK
//
// Setup KV binding: BACKUP_KV
// Env vars: AUTH_TOKEN (segreto)
// ============================================================================

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...extra },
  });
}

function text(body, status = 200, extra = {}) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS, ...extra },
  });
}

function checkAuth(req, env) {
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return false;
  const token = auth.slice(7).trim();
  return token && token === env.AUTH_TOKEN;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // Health
    if (url.pathname === '/health') {
      return text('OK');
    }

    if (url.pathname === '/backup') {
      if (!env.AUTH_TOKEN) {
        return json({ error: 'AUTH_TOKEN non configurato lato server' }, 500);
      }
      if (!env.BACKUP_KV) {
        return json({ error: 'KV BACKUP_KV non legato' }, 500);
      }
      if (!checkAuth(req, env)) {
        return json({ error: 'Unauthorized' }, 401);
      }

      const key = `backup:${env.AUTH_TOKEN.slice(0, 12)}`;

      if (req.method === 'POST') {
        const body = await req.text();
        if (body.length > 5 * 1024 * 1024) {
          return json({ error: 'Backup troppo grande (>5MB)' }, 413);
        }
        await env.BACKUP_KV.put(key, body, {
          metadata: { updatedAt: new Date().toISOString(), size: body.length },
        });
        return json({ ok: true, savedAt: new Date().toISOString(), size: body.length });
      }

      if (req.method === 'GET') {
        const { value, metadata } = await env.BACKUP_KV.getWithMetadata(key);
        if (!value) return json({ error: 'Nessun backup trovato' }, 404);
        return new Response(value, {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'X-Updated-At': metadata?.updatedAt || '',
            ...CORS,
          },
        });
      }

      return json({ error: 'Method not allowed' }, 405);
    }

    return text(
      'RunFit Worker\n' +
      'GET  /health\n' +
      'GET  /backup    (Bearer)\n' +
      'POST /backup    (Bearer + JSON body)\n',
      404,
    );
  },
};
