#!/usr/bin/env node
'use strict';

/**
 * Self-test for getcourier. Mocks global fetch; hits no network.
 * Run: node test/selftest.js
 */

const assert = require('node:assert');

const lib = require('../index.js');
const { main: cliMain, parseArgs } = require('../bin/getcourier.js');

const { createInbox, waitForCode, listMessages, getMessage, deleteInbox, pricing, CourierError, QuotaExceededError } = lib;

let passed = 0;
const failures = [];

function ok(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    failures.push(`${name}: ${err && err.message ? err.message : err}`);
    console.error(`FAIL ${name}\n  ${err && err.stack ? err.stack.split('\n').slice(0, 4).join('\n  ') : err}`);
  }
}

async function okAsync(name, fn) {
  try {
    await fn();
    passed += 1;
  } catch (err) {
    failures.push(`${name}: ${err && err.message ? err.message : err}`);
    console.error(`FAIL ${name}\n  ${err && err.stack ? err.stack.split('\n').slice(0, 6).join('\n  ') : err}`);
  }
}

/* ------------------------------------------------------------------ */
/* fetch mock                                                          */
/* ------------------------------------------------------------------ */

function jsonResponse(status, body, headers = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/**
 * handlers: [{ method = 'GET', path includes string, status, body, headers }]
 * Matched in order; each handler is consumed once.
 */
function makeFetch(handlers) {
  const calls = [];
  const queue = handlers.map((h) => ({ ...h, used: false }));

  const fetchMock = async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    const call = {
      url,
      method,
      headers: init.headers || {},
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);

    const handler = queue.find(
      (h) => !h.used && (h.method || 'GET').toUpperCase() === method && url.includes(h.path),
    );
    if (!handler) {
      throw new Error(`unexpected fetch: ${method} ${url}`);
    }
    if (!handler.reusable) handler.used = true;
    if (handler.onCall) handler.onCall(call);
    if (handler.response instanceof Error) throw handler.response;
    return jsonResponse(handler.status || 200, handler.body, handler.headers || {});
  };

  return { fetchMock, calls, queue };
}

const INBOX_BODY = {
  success: true,
  address: 'my-agent-k3xmqz@getcourier.dev',
  inbox_id: '5b40d4d6-c046-46c9-aaa1-d0f1e20194e0',
  read_token: 'rt_test_token',
  expires_at: '2026-10-26T12:00:00.000Z',
  ttl_hours: 72,
  paid: false,
  identity: {
    did: 'did:key:z6Mktest',
    public_key: 'pubkey',
    fingerprint: '9f2c4b1d0a7e5566',
    private_key: 'privkey',
  },
  alias: {
    alias: 'my-agent-k3xmqz',
    inbox_id: '5b40d4d6-c046-46c9-aaa1-d0f1e20194e0',
    read_token: 'rt_test_token',
    created_at: '2026-10-23T12:00:00.000Z',
    expires_at: '2026-10-26T12:00:00.000Z',
  },
  links: {
    messages: '/inbox/5b40d4d6-c046-46c9-aaa1-d0f1e20194e0/messages',
    wait: '/v1/sandbox/inboxes/my-agent-k3xmqz/wait',
    mcp: '/mcp',
  },
};

const MESSAGE = {
  id: 'msg_01JTEST',
  received_at: '2026-10-23T12:00:03.000Z',
  from: 'no-reply@example.com',
  from_name: 'Example',
  subject: 'Your verification code',
  codes: ['482913'],
  links: ['https://example.com/verify?token=abc'],
  text: 'Your code is 482913.',
  auth: { verdict: 'pass', spf: 'pass', dkim: 'pass', dmarc: 'pass' },
  untrusted: true,
  marker: 'UNTRUSTED EXTERNAL EMAIL',
};

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

async function testCreate() {
  const { fetchMock, calls } = makeFetch([{ method: 'POST', path: '/alias', status: 201, body: INBOX_BODY }]);

  const inbox = await createInbox({
    alias: 'my-agent',
    purpose: 'signing up for an API key',
    agent: 'build-bot-7',
    fetch: fetchMock,
  });

  const call = calls[0];
  assert.strictEqual(call.url, 'https://getcourier.dev/alias', 'POSTs to /alias');
  assert.strictEqual(call.method, 'POST');
  assert.strictEqual(call.headers['user-agent'], 'getcourier-js/0.1.0', 'sends the package User-Agent');
  assert.deepStrictEqual(call.body, {
    alias: 'my-agent',
    purpose: 'signing up for an API key',
    agent: 'build-bot-7',
  });

  assert.strictEqual(inbox.address, 'my-agent-k3xmqz@getcourier.dev');
  assert.strictEqual(inbox.alias, 'my-agent-k3xmqz', 'alias is the local part string');
  assert.strictEqual(inbox.inboxId, '5b40d4d6-c046-46c9-aaa1-d0f1e20194e0');
  assert.strictEqual(inbox.readToken, 'rt_test_token');
  assert.strictEqual(inbox.expiresAt, '2026-10-26T12:00:00.000Z');
  assert.strictEqual(inbox.ttlHours, 72);
  assert.strictEqual(inbox.paid, false);
  assert.strictEqual(inbox.identity.did, 'did:key:z6Mktest');
}

async function testCreateNoBody() {
  const { fetchMock, calls } = makeFetch([{ method: 'POST', path: '/alias', status: 201, body: INBOX_BODY }]);
  // createInbox posts to /alias; no fields -> empty body
  const inbox = await createInbox({ fetch: fetchMock });
  assert.deepStrictEqual(calls[0].body, {}, 'empty options send an empty JSON body');
  assert.strictEqual(inbox.readToken, 'rt_test_token');
}

async function testWaitRetriesLongPoll() {
  const { fetchMock, calls } = makeFetch([
    { method: 'GET', path: '/wait', status: 200, body: { message: null, timeout: true } },
    {
      method: 'GET',
      path: '/wait',
      status: 200,
      body: { message: { id: 'msg_01JTEST', codes: ['482913'], links: [] }, code: '482913', link: null },
    },
  ]);

  const inbox = { alias: 'my-agent-k3xmqz', readToken: 'rt_test_token' };
  const result = await waitForCode(inbox, { timeoutSeconds: 2, after: 'msg_01JOLD', fetch: fetchMock });

  assert.strictEqual(calls.length, 2, 'retries the long-poll after a timeout response');
  assert.ok(
    calls[0].url.startsWith('https://getcourier.dev/v1/sandbox/inboxes/my-agent-k3xmqz/wait?'),
    `wait URL shape: ${calls[0].url}`,
  );
  assert.ok(calls[0].url.includes('timeout='), 'sends timeout');
  assert.ok(calls[0].url.includes('after=msg_01JOLD'), 'forwards after');
  assert.strictEqual(calls[0].headers.authorization, 'Bearer rt_test_token');
  assert.strictEqual(result.code, '482913');
  assert.strictEqual(result.link, null);
  assert.strictEqual(result.timeout, false);
  assert.strictEqual(result.message.id, 'msg_01JTEST');
}

async function testWaitReturnsLink() {
  const { fetchMock } = makeFetch([
    {
      method: 'GET',
      path: '/wait',
      status: 200,
      body: { message: { id: 'msg_02' }, code: null, link: 'https://example.com/magic?t=1' },
    },
  ]);
  const result = await waitForCode({ alias: 'inbox-abc123', readToken: 'rt' }, { timeoutSeconds: 1, fetch: fetchMock });
  assert.strictEqual(result.code, null);
  assert.strictEqual(result.link, 'https://example.com/magic?t=1');
  assert.strictEqual(result.timeout, false);
}

async function testWaitDeadline() {
  const { fetchMock, calls } = makeFetch([
    { method: 'GET', path: '/wait', status: 200, body: { message: null, timeout: true }, reusable: true },
  ]);
  const started = Date.now();
  const result = await waitForCode('inbox-abc123', { token: 'rt', timeoutSeconds: 0.3, fetch: fetchMock });
  const elapsed = Date.now() - started;
  assert.strictEqual(result.timeout, true, 'reports timeout at the deadline');
  assert.strictEqual(result.message, null);
  assert.ok(calls.length >= 1, 'polled at least once');
  assert.ok(elapsed < 2000, `respects the overall deadline (took ${elapsed}ms)`);
}

async function testWaitRequiresToken() {
  await assert.rejects(() => waitForCode('inbox-abc123', { timeoutSeconds: 1 }), (err) => {
    assert.ok(err instanceof CourierError);
    assert.strictEqual(err.code, 'UNAUTHORIZED');
    return true;
  });
}

async function testQuotaExceeded() {
  const body = {
    error: true,
    code: 'FREE_QUOTA_EXCEEDED',
    message: 'Free tier limit reached: 5 inboxes per day per IP.',
    retryable: true,
    hint: 'Free tier: 3 inboxes/hour and 5/day per IP.',
    request_id: 'req_quota_1',
    retry_after_seconds: 900,
  };
  const { fetchMock } = makeFetch([
    { method: 'POST', path: '/alias', status: 402, body, headers: { 'retry-after': '900' } },
  ]);

  let caught;
  try {
    await createInbox({ purpose: 'signup', fetch: fetchMock });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, 'rejects on 402');
  assert.ok(caught instanceof QuotaExceededError, 'is a QuotaExceededError');
  assert.ok(caught instanceof CourierError, 'is a CourierError');
  assert.strictEqual(caught.code, 'FREE_QUOTA_EXCEEDED');
  assert.strictEqual(caught.status, 402);
  assert.strictEqual(caught.retryable, true);
  assert.strictEqual(caught.retryAfter, 900, 'exposes retryAfter seconds');
  assert.strictEqual(caught.retryAfterSeconds, 900);
  assert.strictEqual(caught.requestId, 'req_quota_1');
  assert.ok(caught.hint.includes('3 inboxes/hour'));
  assert.ok(caught.message.includes('Free tier limit'));
  assert.strictEqual(JSON.parse(JSON.stringify(caught)).retry_after_seconds, 900);
}

async function testRetryAfterHeaderOnly() {
  const body = { error: true, code: 'RATE_LIMITED', message: 'Too many requests', retryable: true };
  const { fetchMock } = makeFetch([
    { method: 'POST', path: '/alias', status: 429, body, headers: { 'retry-after': '42' } },
  ]);
  await assert.rejects(() => createInbox({ fetch: fetchMock }), (err) => {
    assert.ok(err instanceof CourierError);
    assert.strictEqual(err.code, 'RATE_LIMITED');
    assert.strictEqual(err.retryAfter, 42, 'falls back to the Retry-After header');
    assert.strictEqual(err.retryable, true);
    return true;
  });
}

async function testListAndGet() {
  const body = {
    success: true,
    inbox_id: '5b40d4d6-c046-46c9-aaa1-d0f1e20194e0',
    address: 'my-agent-k3xmqz@getcourier.dev',
    untrusted: true,
    marker: 'UNTRUSTED EXTERNAL EMAIL',
    messages: [MESSAGE],
    count: 1,
  };
  const { fetchMock, calls } = makeFetch([
    { method: 'GET', path: '/messages?after=', status: 200, body },
    { method: 'GET', path: `/messages/${MESSAGE.id}`, status: 200, body: MESSAGE },
  ]);

  const inbox = { alias: 'my-agent-k3xmqz', readToken: 'rt_test_token' };
  const listed = await listMessages(inbox, { after: 'msg_01JOLD', limit: 5, fetch: fetchMock });
  assert.strictEqual(listed.count, 1);
  assert.strictEqual(listed.messages[0].codes[0], '482913');
  assert.ok(calls[0].url.includes('/v1/sandbox/inboxes/my-agent-k3xmqz/messages?'));
  assert.ok(calls[0].url.includes('limit=5'));
  assert.strictEqual(calls[0].headers.authorization, 'Bearer rt_test_token');

  const one = await getMessage('my-agent-k3xmqz', MESSAGE.id, { token: 'rt_test_token', fetch: fetchMock });
  assert.strictEqual(one.id, MESSAGE.id);
  assert.strictEqual(one.marker, 'UNTRUSTED EXTERNAL EMAIL');
}

async function testDelete() {
  const { fetchMock, calls } = makeFetch([{ method: 'DELETE', path: '/v1/sandbox/inboxes/my-agent-k3xmqz', status: 200, body: { success: true } }]);
  const result = await deleteInbox({ alias: 'my-agent-k3xmqz', readToken: 'rt_test_token' }, { fetch: fetchMock });
  assert.strictEqual(result.success, true);
  assert.strictEqual(calls[0].method, 'DELETE');
  assert.strictEqual(calls[0].headers.authorization, 'Bearer rt_test_token');
}

async function testBaseUrlOverride() {
  const previous = process.env.GETCOURIER_BASE_URL;
  process.env.GETCOURIER_BASE_URL = 'https://api.example.test/';
  try {
    const { fetchMock, calls } = makeFetch([
      { method: 'GET', path: '/v1/pricing', status: 200, body: { unit: 'credit', credit_usd: 0.0001, prices: [], rails: [] } },
    ]);
    const p = await pricing({ fetch: fetchMock });
    assert.strictEqual(calls[0].url, 'https://api.example.test/v1/pricing', 'honours GETCOURIER_BASE_URL and strips trailing slash');
    assert.strictEqual(p.credit_usd, 0.0001);
  } finally {
    if (previous === undefined) delete process.env.GETCOURIER_BASE_URL;
    else process.env.GETCOURIER_BASE_URL = previous;
  }
}

function testCliParse() {
  const wait = parseArgs(['wait', 'my-agent-k3xmqz', '--token', 'rt_1', '--timeout', '120']);
  assert.strictEqual(wait.command, 'wait');
  assert.strictEqual(wait.alias, 'my-agent-k3xmqz');
  assert.strictEqual(wait.token, 'rt_1');
  assert.strictEqual(wait.timeout, 120);

  const create = parseArgs(['new', '--wait', '--purpose', 'signup', '--agent', 'bot']);
  assert.strictEqual(create.command, 'new');
  assert.strictEqual(create.wait, true);
  assert.strictEqual(create.purpose, 'signup');
  assert.strictEqual(create.agent, 'bot');

  const inline = parseArgs(['--token=rt_2', '--timeout=30', 'wait', 'abc123def']);
  assert.strictEqual(inline.command, 'wait');
  assert.strictEqual(inline.token, 'rt_2');
  assert.strictEqual(inline.timeout, 30);
  assert.strictEqual(inline.alias, 'abc123def');

  assert.strictEqual(parseArgs([]).command, 'new', 'no args means create an inbox');
  assert.strictEqual(parseArgs(['--help']).help, true);
  assert.strictEqual(parseArgs(['-h']).help, true);

  assert.throws(() => parseArgs(['wait', 'x', '--bogus']), /Unknown option/);
  assert.throws(() => parseArgs(['wait', 'x', '--timeout', 'abc']), /Invalid --timeout/);
}

function capture() {
  const out = [];
  const err = [];
  return {
    io: {
      stdout: (s) => out.push(String(s)),
      stderr: (s) => err.push(String(s)),
    },
    out: () => out.join(''),
    err: () => err.join(''),
  };
}

async function testCliCreate() {
  const { fetchMock } = makeFetch([{ method: 'POST', path: '/alias', status: 201, body: INBOX_BODY }]);
  const c = capture();
  const code = await cliMain(['--purpose', 'signup'], { ...c.io, fetch: fetchMock });
  assert.strictEqual(code, 0, 'exit code 0');
  const parsed = JSON.parse(c.out());
  assert.strictEqual(parsed.address, 'my-agent-k3xmqz@getcourier.dev');
  assert.strictEqual(parsed.read_token, 'rt_test_token');
  assert.strictEqual(parsed.inbox_id, '5b40d4d6-c046-46c9-aaa1-d0f1e20194e0');
  assert.strictEqual(c.err(), '', 'nothing on stderr');
}

async function testCliWait() {
  const { fetchMock } = makeFetch([
    {
      method: 'GET',
      path: '/wait',
      status: 200,
      body: { message: { id: 'msg_01JTEST', codes: ['482913'], links: [] }, code: '482913', link: null },
    },
  ]);
  const c = capture();
  const code = await cliMain(['wait', 'my-agent-k3xmqz', '--token', 'rt_test_token', '--timeout', '5'], {
    ...c.io,
    fetch: fetchMock,
  });
  assert.strictEqual(code, 0);
  const parsed = JSON.parse(c.out());
  assert.strictEqual(parsed.code, '482913');
  assert.strictEqual(parsed.timeout, false);
  assert.strictEqual(parsed.message.id, 'msg_01JTEST');
}

async function testCliNewWait() {
  const { fetchMock } = makeFetch([
    { method: 'POST', path: '/alias', status: 201, body: INBOX_BODY },
    {
      method: 'GET',
      path: '/wait',
      status: 200,
      body: { message: { id: 'msg_01JTEST' }, code: '482913', link: null },
    },
  ]);
  const c = capture();
  const code = await cliMain(['new', '--wait', '--timeout', '5'], { ...c.io, fetch: fetchMock });
  assert.strictEqual(code, 0);
  const parsed = JSON.parse(c.out());
  assert.strictEqual(parsed.address, 'my-agent-k3xmqz@getcourier.dev');
  assert.strictEqual(parsed.read_token, 'rt_test_token');
  assert.strictEqual(parsed.code, '482913');
}

async function testCliErrors() {
  // missing --token
  let c = capture();
  let code = await cliMain(['wait', 'my-agent-k3xmqz'], { ...c.io, fetch: async () => jsonResponse(500, {}) });
  assert.strictEqual(code, 2, 'usage error exit code');
  assert.ok(c.err().includes('--token'), `stderr explains the missing token: ${c.err()}`);

  // API error -> exit 1, stderr, non-empty
  const { fetchMock } = makeFetch([
    {
      method: 'POST',
      path: '/alias',
      status: 402,
      body: { error: true, code: 'FREE_QUOTA_EXCEEDED', message: 'quota', retryable: true, retry_after_seconds: 60 },
    },
  ]);
  c = capture();
  code = await cliMain([], { ...c.io, fetch: fetchMock });
  assert.strictEqual(code, 1, 'API error exit code');
  assert.ok(c.err().includes('FREE_QUOTA_EXCEEDED'), 'stderr carries the error code');
  assert.ok(c.err().includes('retry after 60s'), 'stderr carries retryAfter');
  assert.strictEqual(c.out(), '', 'nothing misleading on stdout');

  // --help
  c = capture();
  code = await cliMain(['--help'], { ...c.io, fetch: fetchMock });
  assert.strictEqual(code, 0);
  assert.ok(c.out().includes('Usage:'), '--help prints usage');
  assert.ok(c.out().includes('getcourier.dev/mcp'), '--help mentions the MCP alternative');
}

async function testCliTimeoutExit() {
  const { fetchMock } = makeFetch([
    { method: 'GET', path: '/wait', status: 200, body: { message: null, timeout: true }, reusable: true },
  ]);
  const c = capture();
  const code = await cliMain(['wait', 'inbox-abc123', '--token', 'rt', '--timeout', '0.3'], {
    ...c.io,
    fetch: fetchMock,
  });
  assert.strictEqual(code, 3, 'timeout exit code is non-zero');
  const parsed = JSON.parse(c.out());
  assert.strictEqual(parsed.timeout, true);
  assert.strictEqual(parsed.code, null);
  assert.ok(c.err().includes('timed out'));
}

/* ------------------------------------------------------------------ */

async function run() {
  ok('CLI arg parsing', testCliParse);

  await okAsync('createInbox posts to /alias with UA + fields', testCreate);
  await okAsync('createInbox with no options sends {}', testCreateNoBody);
  await okAsync('waitForCode retries the long-poll', testWaitRetriesLongPoll);
  await okAsync('waitForCode returns a magic link', testWaitReturnsLink);
  await okAsync('waitForCode respects the deadline', testWaitDeadline);
  await okAsync('waitForCode requires a read_token', testWaitRequiresToken);
  await okAsync('402 FREE_QUOTA_EXCEEDED is a typed, retryable error', testQuotaExceeded);
  await okAsync('Retry-After header is parsed', testRetryAfterHeaderOnly);
  await okAsync('listMessages + getMessage', testListAndGet);
  await okAsync('deleteInbox sends DELETE', testDelete);
  await okAsync('GETCOURIER_BASE_URL override', testBaseUrlOverride);
  await okAsync('CLI: create inbox', testCliCreate);
  await okAsync('CLI: wait <alias> --token', testCliWait);
  await okAsync('CLI: new --wait', testCliNewWait);
  await okAsync('CLI: usage and API errors', testCliErrors);
  await okAsync('CLI: timeout exit code', testCliTimeoutExit);

  if (failures.length) {
    console.error(`\n${failures.length} FAILED, ${passed} passed`);
    process.exit(1);
  }
  console.log(`\nALL PASS (${passed} checks)`);
}

run().catch((err) => {
  console.error('selftest crashed:', err);
  process.exit(1);
});
