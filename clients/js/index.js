'use strict';

/**
 * getcourier — client for the hosted GetCourier API (https://getcourier.dev).
 *
 * Zero dependencies. Requires Node >= 18 (global fetch).
 *
 *   const { createInbox, waitForCode } = require('getcourier');
 *   const inbox = await createInbox({ purpose: 'signing up for an API key' });
 *   const hit = await waitForCode(inbox, { timeoutSeconds: 60 });
 *   console.log(hit.code);
 */

const VERSION = '0.1.0';
const USER_AGENT = `getcourier-js/${VERSION}`;
const DEFAULT_BASE_URL = 'https://getcourier.dev';
const MAX_WAIT_SECONDS = 55; // server clamps `timeout` to 1..55
const RETRY_SLICE_MS = 50; // pause between completed long-polls

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

/**
 * Error raised for any non-2xx response (and for transport failures).
 * `code` mirrors the API error code, e.g. FREE_QUOTA_EXCEEDED.
 */
class CourierError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'CourierError';
    this.code = options.code || 'COURIER_ERROR';
    this.status = typeof options.status === 'number' ? options.status : null;
    this.retryable = Boolean(options.retryable);
    /** Seconds to wait before retrying (from body or Retry-After), or null. */
    this.retryAfter = typeof options.retryAfter === 'number' ? options.retryAfter : null;
    this.hint = options.hint == null ? null : options.hint;
    this.requestId = options.requestId == null ? null : options.requestId;
    this.payment = options.payment == null ? null : options.payment;
    this.body = options.body == null ? null : options.body;
  }

  /** Alias of `retryAfter`, matching the API field name. */
  get retryAfterSeconds() {
    return this.retryAfter;
  }

  toJSON() {
    return {
      error: true,
      code: this.code,
      message: this.message,
      status: this.status,
      retryable: this.retryable,
      retry_after_seconds: this.retryAfter,
      hint: this.hint,
      request_id: this.requestId,
    };
  }
}

/** 402 with code FREE_QUOTA_EXCEEDED: the free tier (3/hour, 5/day per IP) is used up. */
class QuotaExceededError extends CourierError {
  constructor(message, options = {}) {
    super(message, { ...options, code: 'FREE_QUOTA_EXCEEDED', retryable: true });
    this.name = 'QuotaExceededError';
  }
}

/** 402 for paid usage: longer inboxes / credits needed. */
class PaymentRequiredError extends CourierError {
  constructor(message, options = {}) {
    super(message, { ...options, code: options.code || 'PAYMENT_REQUIRED' });
    this.name = 'PaymentRequiredError';
  }
}

/* ------------------------------------------------------------------ */
/* Internals                                                           */
/* ------------------------------------------------------------------ */

function baseUrl() {
  const raw = (typeof process !== 'undefined' && process.env && process.env.GETCOURIER_BASE_URL) || DEFAULT_BASE_URL;
  return String(raw).replace(/\/+$/, '');
}

function getFetch(options = {}) {
  const impl = options.fetch || (typeof globalThis !== 'undefined' ? globalThis.fetch : undefined);
  if (typeof impl !== 'function') {
    throw new CourierError('No fetch implementation available; Node >= 18 is required or pass options.fetch.', {
      code: 'NO_FETCH',
    });
  }
  return impl;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (ms <= 0) return resolve();
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      reject(err);
    }
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function parseRetryAfter(value) {
  if (value == null || value === '') return null;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber)) return asNumber;
  const asDate = Date.parse(String(value));
  if (Number.isFinite(asDate)) return Math.max(0, Math.round((asDate - Date.now()) / 1000));
  return null;
}

function errorFromResponse(res, data) {
  const body = data && typeof data === 'object' ? data : {};
  const code = body.code || body.error || `HTTP_${res.status}`;
  const message = body.message || (typeof body.error === 'string' ? body.error : `Request failed with HTTP ${res.status}`);
  const retryAfter =
    typeof body.retry_after_seconds === 'number'
      ? body.retry_after_seconds
      : parseRetryAfter(res.headers && typeof res.headers.get === 'function' ? res.headers.get('retry-after') : null);

  const options = {
    code,
    status: res.status,
    retryable: body.retryable != null ? Boolean(body.retryable) : res.status === 429 || res.status >= 500,
    retryAfter,
    hint: body.hint,
    requestId: body.request_id,
    payment: body.payment,
    body: body,
  };

  if (res.status === 402 && code === 'FREE_QUOTA_EXCEEDED') {
    return new QuotaExceededError(message, { ...options, retryable: true });
  }
  if (res.status === 402) {
    return new PaymentRequiredError(message, options);
  }
  return new CourierError(message, options);
}

async function request(pathname, options = {}) {
  const {
    method = 'GET',
    body,
    token,
    query,
    headers = {},
    signal,
    fetch: fetchOption,
  } = options;

  const url = new URL(baseUrl() + pathname);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
  }

  const finalHeaders = {
    accept: 'application/json',
    'user-agent': USER_AGENT,
    ...headers,
  };
  if (body !== undefined) finalHeaders['content-type'] = 'application/json';
  if (token) finalHeaders.authorization = `Bearer ${token}`;

  const fetchImpl = getFetch({ fetch: fetchOption });

  let res;
  try {
    res = await fetchImpl(url.toString(), {
      method,
      headers: finalHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err && (err.name === 'AbortError' || err.name === 'TimeoutError')) throw err;
    throw new CourierError(`Network error talking to ${url.origin}: ${err && err.message ? err.message : err}`, {
      code: 'NETWORK_ERROR',
      retryable: true,
    });
  }

  const text = typeof res.text === 'function' ? await res.text() : '';
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = { raw: text };
    }
  }

  if (!res.ok) throw errorFromResponse(res, data);
  return data;
}

/** Accepts an inbox object (createInbox result), or an alias string plus { token }. */
function resolveInbox(inbox, options = {}) {
  if (typeof inbox === 'string') {
    if (!inbox.trim()) throw new CourierError('An inbox alias is required.', { code: 'BAD_REQUEST' });
    const token = options.token || options.readToken;
    if (!token) throw new CourierError('A read_token is required to read an inbox.', { code: 'UNAUTHORIZED' });
    return { alias: inbox.trim(), readToken: token };
  }
  if (!inbox || typeof inbox !== 'object') {
    throw new CourierError('Pass an inbox object returned by createInbox(), or an alias string with { token }.', {
      code: 'BAD_REQUEST',
    });
  }
  const alias = inbox.alias || (typeof inbox.address === 'string' ? inbox.address.split('@')[0] : null);
  const readToken = inbox.readToken || inbox.read_token || options.token || options.readToken;
  if (!alias) throw new CourierError('Inbox object has no alias/address.', { code: 'BAD_REQUEST' });
  if (!readToken) throw new CourierError('Inbox object has no read_token.', { code: 'UNAUTHORIZED' });
  return { alias, readToken };
}

function clampWaitSeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 30;
  return Math.min(MAX_WAIT_SECONDS, Math.max(1, Math.ceil(n)));
}

function normalizeInbox(data) {
  const body = data || {};
  const alias = (body.alias && typeof body.alias === 'object' ? body.alias.alias : body.alias) ||
    (typeof body.address === 'string' ? body.address.split('@')[0] : null);

  return {
    address: body.address,
    alias,
    inboxId: body.inbox_id,
    readToken: body.read_token,
    expiresAt: body.expires_at,
    ttlHours: body.ttl_hours,
    paid: Boolean(body.paid),
    identity: body.identity || null,
    links: body.links || null,
    chargedCredits: body.charged_credits,
    balance: body.balance,
    raw: body,
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Create an inbox. POST /alias — no auth, no signup.
 *
 * @param {{alias?: string, purpose?: string, agent?: string, ttlHours?: number,
 *          accountKey?: string, fetch?: Function, signal?: AbortSignal}} [options]
 */
async function createInbox(options = {}) {
  const { alias, purpose, agent, ttlHours, accountKey, fetch: fetchOption, signal } = options;

  const body = {};
  if (alias !== undefined) body.alias = alias;
  if (purpose !== undefined) body.purpose = purpose;
  if (agent !== undefined) body.agent = agent;
  if (ttlHours !== undefined) body.ttl_hours = ttlHours;

  const data = await request('/alias', {
    method: 'POST',
    body,
    token: accountKey,
    fetch: fetchOption,
    signal,
  });
  return normalizeInbox(data);
}

/**
 * Long-poll GET /v1/sandbox/inboxes/{alias}/wait until a message with a code or
 * magic link arrives. Each poll uses the server's timeout (1..55s, default 30);
 * polls are repeated until the overall `timeoutSeconds` deadline.
 *
 * Resolves to { message, code, link, timeout } — on deadline expiry
 * message/code/link are null and timeout is true.
 *
 * @param {object|string} inbox
 * @param {{token?: string, readToken?: string, timeoutSeconds?: number,
 *          after?: string, signal?: AbortSignal, fetch?: Function}} [options]
 */
async function waitForCode(inbox, options = {}) {
  const { timeoutSeconds = 30, after, signal } = options;
  const { alias, readToken } = resolveInbox(inbox, options);

  const totalSeconds = Number(timeoutSeconds);
  const budgetMs = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds * 1000 : 30 * 1000;
  const deadline = Date.now() + budgetMs;

  let last = { message: null, code: null, link: null, timeout: true };
  let afterId = after;

  for (;;) {
    if (signal && signal.aborted) {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) return last;

    const pollSeconds = clampWaitSeconds(remaining / 1000);

    let data;
    try {
      data = await request(`/v1/sandbox/inboxes/${encodeURIComponent(alias)}/wait`, {
        query: { timeout: pollSeconds, after: afterId },
        token: readToken,
        fetch: options.fetch,
        signal,
      });
    } catch (err) {
      // Retryable API errors (429, retryable 402) are retried while time remains.
      if (err instanceof CourierError && err.retryable && err.retryAfter != null) {
        const waitMs = Math.min(err.retryAfter * 1000, Math.max(0, deadline - Date.now()));
        if (waitMs > 0) {
          await sleep(waitMs, signal);
          continue;
        }
      }
      throw err;
    }

    if (data && data.message) {
      return {
        message: data.message,
        code: data.code != null ? data.code : null,
        link: data.link != null ? data.link : null,
        timeout: false,
      };
    }

    last = { message: null, code: null, link: null, timeout: true };
    if (remaining - RETRY_SLICE_MS <= 0) return last;
    await sleep(RETRY_SLICE_MS, signal);
  }
}

/**
 * List messages: GET /v1/sandbox/inboxes/{alias}/messages
 *
 * @param {object|string} inbox
 * @param {{token?: string, after?: string, limit?: number, fetch?: Function, signal?: AbortSignal}} [options]
 */
async function listMessages(inbox, options = {}) {
  const { alias, readToken } = resolveInbox(inbox, options);
  const data = await request(`/v1/sandbox/inboxes/${encodeURIComponent(alias)}/messages`, {
    query: { after: options.after, limit: options.limit },
    token: readToken,
    fetch: options.fetch,
    signal: options.signal,
  });
  return data;
}

/**
 * Fetch one message: GET /v1/sandbox/inboxes/{alias}/messages/{id}
 *
 * @param {object|string} inbox
 * @param {string} messageId
 * @param {{token?: string, fetch?: Function, signal?: AbortSignal}} [options]
 */
async function getMessage(inbox, messageId, options = {}) {
  if (!messageId) throw new CourierError('A message id is required.', { code: 'BAD_REQUEST' });
  const { alias, readToken } = resolveInbox(inbox, options);
  return request(
    `/v1/sandbox/inboxes/${encodeURIComponent(alias)}/messages/${encodeURIComponent(messageId)}`,
    { token: readToken, fetch: options.fetch, signal: options.signal },
  );
}

/**
 * Delete (disable) an inbox: DELETE /v1/sandbox/inboxes/{alias}
 *
 * @param {object|string} inbox
 * @param {{token?: string, fetch?: Function, signal?: AbortSignal}} [options]
 */
async function deleteInbox(inbox, options = {}) {
  const { alias, readToken } = resolveInbox(inbox, options);
  const data = await request(`/v1/sandbox/inboxes/${encodeURIComponent(alias)}`, {
    method: 'DELETE',
    token: readToken,
    fetch: options.fetch,
    signal: options.signal,
  });
  return { success: data ? data.success !== false : true };
}

/**
 * Public pricing: GET /v1/pricing
 *
 * @param {{fetch?: Function, signal?: AbortSignal}} [options]
 */
async function pricing(options = {}) {
  return request('/v1/pricing', { fetch: options.fetch, signal: options.signal });
}

module.exports = {
  VERSION,
  USER_AGENT,
  DEFAULT_BASE_URL,
  CourierError,
  QuotaExceededError,
  PaymentRequiredError,
  createInbox,
  waitForCode,
  listMessages,
  getMessage,
  deleteInbox,
  pricing,
  // exposed for tests / advanced use
  _internal: { request, resolveInbox, normalizeInbox, baseUrl, clampWaitSeconds },
};
