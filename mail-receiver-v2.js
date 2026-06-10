/**
 * mail-receiver.js — HTTP email receiver with isolated inbox architecture.
 *
 * V2: inbox-scoped namespaces. All retrieval paths require inbox_id.
 * Backward compatible: /messages without inbox_id returns a migration notice.
 */

const http = require('http');
const path = require('path');
const { CourierInbox } = require(path.join(__dirname, '..', 'courier-inbox', 'src', 'index.js'));
const { CourierInboxV2 } = require(path.join(__dirname, '..', 'courier-inbox', 'src', 'index-v2.js'));
const { InboxAdapter } = require('./inbox-adapter.js');
const { WorkflowEngine } = require('./workflow.js');
const { healthCheck } = require('./continuity-health.js');
const CAPABILITIES = require('./capabilities.js');
const telemetry = require('./telemetry.js');
const x402 = require('./x402.js');
const http2 = require('http');

// ─── LNBits ───────────────────────────────────────────────────────────────

const LNBITS_SERVER = 'http://127.0.0.1:3002';
const LNBITS_API = LNBITS_SERVER + '/api/v1';

const TIERS_SATS = {
  hobby: 5000, agent: 25000, autonomous: 100000,
  alias_creation: 100, priority_ingest: 50, bulk_export: 500,
};

// ─── Dual-mode engine ─────────────────────────────────────────────────────
// V2 inbox engine (primary) + legacy V1 (read-only backward compat)

const DATA_DIR = path.join(__dirname, '..', 'courier-inbox', 'data');

let inboxV2, inboxV1, wf, survivalMonitor;

try {
  inboxV2 = new CourierInboxV2(DATA_DIR);
  inboxV1 = new CourierInbox(DATA_DIR);
  wf = new WorkflowEngine();
} catch (e) {
  console.error('Failed to initialize:', e.message);
  process.exit(1);
}
try { survivalMonitor = require('./survival-monitor.js'); } catch {}

// ─── Helpers ──────────────────────────────────────────────────────────────

function createLNbitsInvoice(tier, memo, amountOverride) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      out: false, amount: amountOverride || 100,
      memo: memo || 'Courier x402 payment', tier: tier || 'custom', unit: 'sat',
    });
    const url = new URL(LNBITS_API + '/payments');
    const options = {
      hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Accept': 'application/json' },
      timeout: 5000,
    };
    const req = http2.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid LNBits response: ' + data.substring(0, 200))); }
      });
    });
    req.on('error', (e) => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('LNBits timeout')); });
    req.write(body);
    req.end();
  });
}

function checkLNbitsInvoice(paymentHash) {
  return new Promise((resolve, reject) => {
    const url = new URL(LNBITS_API + '/payments/' + encodeURIComponent(paymentHash));
    const options = {
      hostname: url.hostname, port: url.port, path: url.pathname, method: 'GET',
      headers: { 'Accept': 'application/json' }, timeout: 5000,
    };
    const req = http2.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid LNBits response: ' + data.substring(0, 200))); }
      });
    });
    req.on('error', (e) => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('LNBits timeout')); });
    req.end();
  });
}

const PORT = 3998;
const HOST = '0.0.0.0';

function parseBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', c => {
      chunks.push(c);
      const total = chunks.reduce((s, c) => s + c.length, 0);
      if (total > 26 * 1024 * 1024) { req.destroy(); resolve({ error: 'Request too large', body: null }); }
    });
    req.on('end', () => { resolve({ body: Buffer.concat(chunks), error: null }); });
    req.on('error', () => resolve({ body: null, error: 'Connection error' }));
  });
}

function errJson(code, msg, retryable, retryAfter) {
  const e = { error: true, code: code, message: msg, retryable: !!retryable };
  if (retryAfter) e.retry_after_seconds = retryAfter;
  return e;
}

function sanitizeMessage(m) {
  return {
    id: m.id, inbox_id: m.inbox_id || null, subject: m.subject, from: m.from_addr,
    classification: m.classification, confidence: m.classification_confidence,
    codes: (m.codes || []).map(c => ({ type: c.type, code: c.code.substring(0, 3) + '***' })),
    links: (m.links || []).map(l => ({ type: l.type, domain: l.domain })),
    received_at: m.received_at,
  };
}

// ─── Route Handler ────────────────────────────────────────────────────────

async function handleRequest(req, res) {
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url, 'http://' + host);
  const p = url.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Inbox-Id, X-Agent-Id');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── Telemetry ──────────────────────────────────────────────────────────

  if (p === '/telemetry' && req.method === 'GET') {
    const since = url.searchParams.get('since') || new Date(Date.now() - 86400000).toISOString();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(telemetry.getMetrics({ since }), null, 2));
    return;
  }

  if (p === '/telemetry/repeat-ips' && req.method === 'GET') {
    const min = parseInt(url.searchParams.get('min') || '3', 10);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(telemetry.getRepeatIps(min), null, 2));
    return;
  }

  if (p === '/telemetry/daily' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(telemetry.getDailyReport(), null, 2));
    return;
  }

  // ── Capabilities ───────────────────────────────────────────────────────

  if (p === '/capabilities' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(CAPABILITIES, null, 2));
    return;
  }

  // ── x402 ───────────────────────────────────────────────────────────────

  if (p === '/x402/invoice' && req.method === 'POST') {
    const { body, error } = await parseBody(req);
    let tier = 'custom', memo = 'Courier protocol operation', amountOverride = null;
    if (body && body.length > 0) {
      try { const d = JSON.parse(body.toString()); tier = d.tier || tier; memo = d.memo || memo; if (d.amount) { amountOverride = d.amount; } else if (TIERS_SATS[d.tier]) { amountOverride = TIERS_SATS[d.tier]; } } catch (e) {}
    }
    try {
      const lnbitsInvoice = await createLNbitsInvoice(tier, memo, amountOverride);
      res.writeHead(402, { 'Content-Type': 'application/json', 'X-402-Payment': 'lightning', 'X-402-Invoice': lnbitsInvoice.payment_hash });
      res.end(JSON.stringify({ error: true, code: 'PAYMENT_REQUIRED', message: 'Lightning payment required.', retryable: true,
        invoice: { id: lnbitsInvoice.checking_id, payment_hash: lnbitsInvoice.payment_hash, payment_request: lnbitsInvoice.payment_request, amount_sats: lnbitsInvoice.amount, amount_msat: lnbitsInvoice.amount_msat, tier: tier, expires_at: new Date((lnbitsInvoice.time + lnbitsInvoice.expiry) * 1000).toISOString(), currency: 'BTC', network: 'Lightning', created_at: new Date(lnbitsInvoice.time * 1000).toISOString(), status: lnbitsInvoice.status, lnbits: LNBITS_SERVER, },
      }));
    } catch (e) {
      console.error('LNBits invoice creation failed:', e.message);
      const inv = x402.generateInvoice(tier, memo);
      res.writeHead(402, { 'Content-Type': 'application/json', 'X-402-Payment': 'lightning', 'X-402-Invoice': inv.id });
      res.end(JSON.stringify({ error: true, code: 'PAYMENT_REQUIRED', message: 'Lightning payment required (fallback mode).', retryable: true, fallback: true,
        invoice: { id: inv.id, payment_hash: inv.payment_hash, amount_sats: inv.amount_sats, tier: inv.tier, expires_at: inv.expires_at, currency: inv.currency, network: inv.network },
      }));
    }
    return;
  }

  if (p.startsWith('/x402/invoice/') && req.method === 'GET') {
    const id = p.substring('/x402/invoice/'.length);
    try {
      const lnbitsInvoice = await checkLNbitsInvoice(id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: lnbitsInvoice.checking_id || id, payment_hash: lnbitsInvoice.payment_hash, payment_request: lnbitsInvoice.payment_request, amount_sats: lnbitsInvoice.amount, amount_msat: lnbitsInvoice.amount_msat, tier: lnbitsInvoice.tier || 'custom', status: lnbitsInvoice.status, memo: lnbitsInvoice.memo, created_at: lnbitsInvoice.created_at, expires_at: lnbitsInvoice.expires_at, source: 'lnbits' }));
    } catch (e) {
      const inv = x402.getInvoice(id);
      if (!inv) { res.writeHead(404); res.end(JSON.stringify({ error: true, code: 'INVOICE_NOT_FOUND', message: 'Invoice not found', retryable: false })); return; }
      res.writeHead(200); res.end(JSON.stringify({ id: inv.id, payment_hash: inv.payment_hash, amount_sats: inv.amount_sats, tier: inv.tier, status: inv.status, created_at: inv.created_at, expires_at: inv.expires_at, source: 'x402-fallback' }));
    }
    return;
  }

  if (p === '/x402/stats' && req.method === 'GET') { res.writeHead(200); res.end(JSON.stringify(x402.getInvoiceStats(), null, 2)); return; }
  if (p === '/x402/prices' && req.method === 'GET') { res.writeHead(200); res.end(JSON.stringify({ prices: x402.prices }, null, 2)); return; }

  // ── Health ─────────────────────────────────────────────────────────────

  if (p === '/health' || p === '/') {
    const stats = inboxV2.stats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      service: 'courier-inbox-v2', provider: 'cloudflare/improvmx',
      status: 'running', port: PORT,
      inboxes: stats.total_inboxes,
      messages: stats.total_messages,
      uptime_seconds: Math.floor(process.uptime()),
      retention_modes: { current: 'ephemeral', default_days: 7 },
    }, null, 2));
    return;
  }

  // ── V2: Create Inbox ───────────────────────────────────────────────────

  if (p === '/inbox' && req.method === 'POST') {
    const { body, error } = await parseBody(req);
    if (error) { res.writeHead(400); res.end(JSON.stringify(errJson('INVALID_REQUEST', error, false))); return; }
    try {
      const data = body ? JSON.parse(body.toString('utf-8')) : {};
      const result = inboxV2.createInbox(data.agent || 'default', data.purpose || '', data.service || 'generic');
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, inbox: result }, null, 2));
    } catch (e) {
      res.writeHead(400); res.end(JSON.stringify(errJson('CREATE_FAILED', e.message, false)));
    }
    return;
  }

  // ── V2: Get Inbox ──────────────────────────────────────────────────────

  if (p.startsWith('/inbox/') && req.method === 'GET') {
    const inboxId = p.substring('/inbox/'.length);
    const result = inboxV2.getInbox(inboxId);
    if (!result) { res.writeHead(404); res.end(JSON.stringify(errJson('INBOX_NOT_FOUND', 'Inbox not found', false))); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, inbox: result }, null, 2));
    return;
  }

  // ── V2: Disable Inbox ──────────────────────────────────────────────────

  if (p.startsWith('/inbox/') && req.method === 'DELETE') {
    const inboxId = p.substring('/inbox/'.length);
    const result = inboxV2.disableInbox(inboxId);
    if (!result) { res.writeHead(404); res.end(JSON.stringify(errJson('INBOX_NOT_FOUND', 'Inbox not found', false))); return; }
    res.writeHead(200); res.end(JSON.stringify({ success: true, inbox_id: inboxId, disabled: true }));
    return;
  }

  // ── V2: Set Retention ──────────────────────────────────────────────────

  if (p.startsWith('/inbox/') && req.method === 'PUT' && p.endsWith('/retention')) {
    const inboxId = p.split('/')[2];
    const { body, error } = await parseBody(req);
    if (error) { res.writeHead(400); res.end(JSON.stringify(errJson('INVALID_REQUEST', error, false))); return; }
    try {
      const data = body ? JSON.parse(body.toString('utf-8')) : {};
      const result = inboxV2.setRetentionMode(inboxId, data.mode || 'ephemeral', data.days || null);
      res.writeHead(200); res.end(JSON.stringify({ success: true, inbox_id: inboxId, retention: result }));
    } catch (e) {
      res.writeHead(400); res.end(JSON.stringify(errJson('RETENTION_FAILED', e.message, false)));
    }
    return;
  }

  // ── V2: Inbox Messages ─────────────────────────────────────────────────

  if (p.startsWith('/inbox/') && req.method === 'GET' && p.endsWith('/messages')) {
    const inboxId = p.split('/')[2];
    const limit = parseInt(url.searchParams.get('limit') || '10', 10);
    const messages = inboxV2.getInboxMessages(inboxId, Math.min(limit, 50));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ messages: messages.map(sanitizeMessage) }, null, 2));
    return;
  }

  // ── V2: List Inboxes ───────────────────────────────────────────────────

  if (p === '/inboxes' && req.method === 'GET') {
    const inboxes = inboxV2.listInboxes();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ inboxes }, null, 2));
    return;
  }

  // ── Legacy: Health (backward compat) ───────────────────────────────────

  if (p === '/continuity/health') {
    try {
      const health = healthCheck();
      res.writeHead(health.healthy ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(health, null, 2));
    } catch (e) {
      res.writeHead(500); res.end(JSON.stringify(errJson('SERVICE_UNAVAILABLE', e.message, true)));
    }
    return;
  }

  // ── Stats ──────────────────────────────────────────────────────────────

  if (p === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(inboxV2.stats(), null, 2));
    return;
  }

  // ── Legacy: Alias (backward compat — wraps inbox creation) ─────────────

  if (p === '/alias' && req.method === 'POST') {
    const { body, error } = await parseBody(req);
    if (error) { res.writeHead(400); res.end(JSON.stringify(errJson('INVALID_REQUEST', error, false))); return; }
    try {
      const data = JSON.parse(body.toString('utf-8'));
      const result = inboxV2.createInbox(data.agent || 'default', data.purpose || '', data.service || 'generic');
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, alias: { alias: result.alias, purpose: result.purpose, service: result.service, agent_id: result.agent, is_catch_all: 0, created_at: result.created_at, disabled_at: null, inbox_id: result.inbox_id } }, null, 2));
    } catch (e) {
      res.writeHead(400); res.end(JSON.stringify(errJson('ALIAS_FAILED', e.message, false)));
    }
    return;
  }

  // ── Legacy: List Aliases ───────────────────────────────────────────────

  if (p === '/aliases' && req.method === 'GET') {
    const inboxes = inboxV2.listInboxes();
    // Backward compat format
    const aliases = inboxes.map(i => ({
      alias: i.alias, purpose: i.purpose, service: i.service,
      agent_id: i.agent, is_catch_all: 0,
      created_at: i.created_at, disabled_at: null,
      inbox_id: i.inbox_id,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ aliases }, null, 2));
    return;
  }

  // ── Legacy: Resolve ────────────────────────────────────────────────────

  if (p.startsWith('/resolve/') && req.method === 'GET') {
    const email = decodeURIComponent(p.substring(9));
    const result = inboxV2.resolveAlias(email);
    res.writeHead(result ? 200 : 404, { 'Content-Type': 'application/json' });
    if (result) res.end(JSON.stringify({ resolved: true, alias: result }, null, 2));
    else res.end(JSON.stringify(errJson('ALIAS_NOT_FOUND', 'No alias matches ' + email, false)));
    return;
  }

  // ── CRITICAL CHANGE: Global /messages is DEPRECATED ─────────────────────
  // Previously returned ALL messages globally (security risk).
  // Now requires inbox_id. Returns migration error without it.

  if (p === '/messages' && req.method === 'GET') {
    const inboxId = url.searchParams.get('inbox_id');
    if (!inboxId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: true, code: 'INBOX_ID_REQUIRED',
        message: 'Global message retrieval is deprecated. Specify inbox_id as query parameter.',
        migration_guide: {
          new_url: '/inbox/{inbox_id}/messages?limit=N',
          legacy_url: '/messages?inbox_id=XXXX',
          how_to_get_inbox_id: 'Use GET /inboxes to list your inboxes, or create one with POST /inbox',
        },
        retryable: false,
      }, null, 2));
      return;
    }
    const limit = parseInt(url.searchParams.get('limit') || '10', 10);
    const messages = inboxV2.getInboxMessages(inboxId, Math.min(limit, 50));
    if (messages.length === 0 && !inboxV2.getInbox(inboxId)) {
      res.writeHead(404); res.end(JSON.stringify(errJson('INBOX_NOT_FOUND', 'Invalid inbox_id', false)));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ messages: messages.map(sanitizeMessage), inbox_id: inboxId }, null, 2));
    return;
  }

  // ── Incoming email (V2) ─────────────────────────────────────────────────

  if (p === '/incoming' && req.method === 'POST') {
    const { body, error } = await parseBody(req);
    if (error || !body || body.length === 0) {
      res.writeHead(400); res.end(JSON.stringify(errJson('INVALID_REQUEST', 'No email body received', false))); return;
    }

    const rawEmail = body.toString('utf-8');
    const from = req.headers['x-forwarded-from'] || req.headers['x-improvmx-original-sender'] || 'unknown';
    const to = req.headers['x-forwarded-to'] || req.headers['x-improvmx-original-recipient'] || 'unknown@incoming';
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '0.0.0.0';

    const result = inboxV2.ingest(rawEmail, { from, to, ip, received_via: 'http-forward' });

    if (!result.ingested) {
      if (survivalMonitor) {
        try { survivalMonitor.logEvent('ingest_failed', { to, from, reason: result.error }); } catch {}
      }
      const err = errJson('INGEST_FAILED', result.error || 'Could not ingest message', true);
      res.writeHead(422, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(err));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ingested: true, message_id: result.message_id, inbox_id: result.inbox_id,
      classification: result.classification, confidence: result.confidence,
      codes_found: result.codes_found, links_found: result.links_found,
    }, null, 2));
    return;
  }

  // ── LNBits proxy ───────────────────────────────────────────────────────

  if (p.startsWith('/x402/lnbits/') && (req.method === 'GET' || req.method === 'POST')) {
    const lnbitsPath = p.substring('/x402/lnbits'.length);
    try {
      let bodyData = Buffer.alloc(0);
      if (req.method === 'POST') { const parsed = await parseBody(req); bodyData = parsed.body || Buffer.alloc(0); }
      const proxyResult = await new Promise((resolve) => {
        const opts = { hostname: '127.0.0.1', port: 3002, path: lnbitsPath + (url.search || ''), method: req.method, timeout: 5000 };
        if (bodyData.length > 0) opts.headers = { 'Content-Type': 'application/json', 'Content-Length': bodyData.length };
        const proxyReq = http.request(opts, (proxyRes) => { let data = ''; proxyRes.on('data', (c) => { data += c; }); proxyRes.on('end', () => { resolve({ statusCode: proxyRes.statusCode, data }); }); });
        proxyReq.on('error', (e) => { resolve({ statusCode: 502, data: JSON.stringify({ error: true, code: 'PROXY_ERROR', message: e.message, retryable: true }) }); });
        proxyReq.on('timeout', () => { proxyReq.destroy(); resolve({ statusCode: 504, data: '{}' }); });
        if (bodyData.length > 0) proxyReq.write(bodyData);
        proxyReq.end();
      });
      res.writeHead(proxyResult.statusCode, { 'Content-Type': 'application/json' });
      res.end(proxyResult.data);
    } catch(e) {
      res.writeHead(502); res.end(JSON.stringify({ error: true, code: 'PROXY_ERROR', message: e.message, retryable: true }));
    }
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(errJson('NOT_FOUND', 'No endpoint matches ' + p, false)));
}

// ─── Server ───────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const start = Date.now();
  const originalEnd = res.end.bind(res);
  res.end = function() {
    const duration = Date.now() - start;
    try { telemetry.record(req, res.statusCode, duration); } catch(e) {}
    return originalEnd.apply(this, arguments);
  };
  handleRequest(req, res).catch(err => {
    console.error('Unhandled:', err);
    if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: true, code: 'SERVICE_UNAVAILABLE', message: 'Internal error', retryable: true })); }
  });
});

server.listen(PORT, HOST, () => {
  console.log('Courier V2 running on ' + HOST + ':' + PORT);
  console.log('  Endpoints: /inbox /inboxes /inbox/:id/messages /incoming /alias');
  console.log('  Discovery: /capabilities /health /stats');
  console.log('  Payment:   /x402/invoice /x402/invoice/:id');
  console.log('  Telemetry: /telemetry /telemetry/daily');
});

process.on('SIGTERM', () => { console.log('Shutdown'); server.close(() => process.exit(0)); });
process.on('SIGINT', () => { console.log('Shutdown'); server.close(() => process.exit(0)); });

module.exports = { server };
