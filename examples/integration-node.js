/**
 * courier-protocol — Node.js integration module for Courier
 *
 * Minimal, zero-dependency client for Courier's self-sovereign
 * operational continuity protocol.
 *
 * All functions use native https module — no npm install needed.
 *
 * Usage:
 *   const courier = require('./integration-node');
 *   await courier.discover();           // GET /capabilities
 *   await courier.createAlias({...});   // POST /alias
 *   await courier.sendMessage(...);     // POST /incoming
 *   await courier.getMessages(5);       // GET /messages?limit=5
 */

const https = require('https');
const BASE_URL = 'getcourier.dev';

/**
 * Make a request to the Courier API.
 * Handles retryable vs non-retryable errors automatically.
 *
 * @param {string} method  - HTTP method (GET, POST)
 * @param {string} path    - URL path (e.g., '/capabilities')
 * @param {object} options - headers, body, query params
 * @returns {Promise<object>} Parsed JSON response
 * @throws {CourierError} On non-retryable errors
 *
 * Retryable errors (caller should retry with backoff):
 *   - INGEST_FAILED
 *   - RATE_LIMITED     (check retry_after_seconds)
 *   - PAYMENT_REQUIRED (check pricing tiers)
 *   - SERVICE_UNAVAILABLE
 *
 * Non-retryable errors (caller should NOT retry):
 *   - ALIAS_NOT_FOUND
 *   - ALIAS_EXISTS
 *   - NOT_FOUND
 *   - INVALID_REQUEST
 */
function request(method, path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, `https://${BASE_URL}`);

    // Append query parameters if provided
    if (options.query) {
      Object.entries(options.query).forEach(([k, v]) => url.searchParams.set(k, v));
    }

    const reqOpts = {
      hostname: BASE_URL,
      path: url.pathname + url.search,
      method: method.toUpperCase(),
      headers: {
        'Content-Type': options.contentType || 'application/json',
        ...options.headers,
      },
    };

    const req = https.request(reqOpts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          // Courier always returns JSON, even on errors
          if (parsed.error) {
            const err = new CourierError(
              parsed.message || `HTTP ${res.statusCode}`,
              parsed.code || 'UNKNOWN',
              parsed.retryable || false,
              parsed.retry_after_seconds || null
            );
            return reject(err);
          }
          resolve(parsed);
        } catch (e) {
          // Non-JSON response — server error or unexpected format
          reject(new CourierError(
            `Non-JSON response (HTTP ${res.statusCode}): ${data.slice(0, 200)}`,
            'PARSE_ERROR',
            res.statusCode >= 500, // 5xx errors are retryable
            null
          ));
        }
      });
    });

    req.on('error', (e) => {
      // Network-level errors (DNS, connection refused, timeout)
      reject(new CourierError(
        `Network error: ${e.message}`,
        'NETWORK_ERROR',
        true, // Network errors are always retryable
        null
      ));
    });

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

/**
 * Courier protocol error with retry semantics.
 *
 * Properties:
 *   - message:  Human-readable description
 *   - code:     Courier error code (e.g., 'RATE_LIMITED')
 *   - retryable: Whether the caller should retry
 *   - retryAfter: Seconds to wait before retry (null if unknown)
 */
class CourierError extends Error {
  constructor(message, code, retryable, retryAfter) {
    super(message);
    this.name = 'CourierError';
    this.code = code;
    this.retryable = retryable;
    this.retryAfter = retryAfter;
  }
}

/**
 * Step 1: Discover protocol surface.
 * Returns capabilities, limits, pricing, error semantics, onboarding flow.
 */
async function discover() {
  return request('GET', '/capabilities');
}

/**
 * Step 3: Self-provision an inbound alias.
 * No auth required. No human approval.
 *
 * @param {object} opts
 * @param {string} [opts.alias]   - Desired alias name (auto-generated if omitted)
 * @param {string} [opts.purpose] - Why this alias exists (e.g., 'agent-to-agent')
 * @param {string} [opts.service] - What service this alias serves
 * @param {string} [opts.agent]   - Agent identifier
 * @returns {Promise<object>} { success, alias: { alias, purpose, created_at } }
 */
async function createAlias(opts = {}) {
  return request('POST', '/alias', {
    body: {
      alias: opts.alias,
      purpose: opts.purpose,
      service: opts.service,
      agent: opts.agent,
    },
  });
}

/**
 * Step 4: Send an operational message to an alias.
 *
 * @param {string} to   - Recipient email (e.g., 'my-alias@inbox.getcourier.dev')
 * @param {string} from - Sender identifier (e.g., 'sender@example.com')
 * @param {string} body - Raw message content (RFC 822, plain text, or JSON)
 * @returns {Promise<object>} { ingested, message_id, classification, confidence }
 */
async function sendMessage(to, from, body) {
  return request('POST', '/incoming', {
    headers: {
      'X-Forwarded-To': to,
      'X-Forwarded-From': from,
      'Content-Type': 'text/plain',
    },
    body: body, // Sent as string — write() handles JSON.stringify
  });
}

/**
 * Step 5: Retrieve recent messages with extracted codes and links.
 *
 * @param {number} [limit=10] - Max messages to return
 * @returns {Promise<object>} { messages: [{ id, subject, from, classification, codes, links }] }
 */
async function getMessages(limit = 10) {
  return request('GET', '/messages', {
    query: { limit: String(limit) },
  });
}

module.exports = {
  discover,
  createAlias,
  sendMessage,
  getMessages,
  CourierError, // Exported so callers can check retry semantics
};

// Example autonomous flow (run directly with `node integration-node.js`):
//   const courier = require('./integration-node');
//
//   async function onboard() {
//     const caps = await courier.discover();
//     console.log('Capabilities:', caps.capabilities.map(c => c.name));
//
//     const alias = await courier.createAlias({ purpose: 'agent-to-agent', agent: 'my-agent' });
//     console.log('Alias:', alias.alias.alias);
//
//     const msg = await courier.sendMessage(
//       `${alias.alias.alias}@inbox.getcourier.dev`,
//       'sender@example.com',
//       'From: sender@example.com\nSubject: Verification\n\nYour code is 832947'
//     );
//     console.log('Message ID:', msg.message_id);
//
//     const msgs = await courier.getMessages(5);
//     console.log('Extracted codes:', msgs.messages[0]?.codes || []);
//   }
//
//   onboard().catch(err => {
//     if (err instanceof CourierError && err.retryable) {
//       console.log(`Retryable: ${err.code} — waiting ${err.retryAfter || 5}s`);
//     } else {
//       console.error('Fatal:', err.message);
//     }
//   });
