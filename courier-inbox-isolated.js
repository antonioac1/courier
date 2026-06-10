/**
 * courier-inbox.js — Isolated multi-tenant inbox engine.
 *
 * Each inbox gets its own directory namespace under inboxes/{inbox_id}/.
 * Messages are stored in inbox_messages/{inbox_id}/{msg_id}.json.
 * Alias ownership is enforced — one alias belongs to one inbox.
 *
 * Retrieval is ALWAYS scoped by inbox_id. No global /messages path.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ─── Constants ────────────────────────────────────────────────────────────

const MAX_MESSAGE_SIZE = 25 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;
const RATE_LIMIT_HOUR = 200;
const RATE_LIMIT_RECIPIENT_HOUR = 50;
const ALIAS_PATTERN = /^[a-zA-Z0-9._+-]{1,64}$/;
const INBOX_ID_PATTERN = /^[a-f0-9]{8}$/;  // 8-char hex inbox IDs

// Storage layout:
//   {baseDir}/
//     inboxes/              — inbox metadata files
//       {inbox_id}.json     — inbox record (metadata, aliases, retention)
//     inbox_messages/        — per-inbox message storage
//       {inbox_id}/         — inbox-scoped directory
//         {msg_id}.json     — individual messages
//     sequence.json         — global message ID sequence
//     security.json          — global security event log (append-only core)

// ─── Helpers ──────────────────────────────────────────────────────────────

function now() { return new Date().toISOString(); }
function uuid() { return crypto.randomUUID(); }
function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function readStore(filepath) {
  try { return JSON.parse(fs.readFileSync(filepath, 'utf-8')); }
  catch { return null; }
}

function writeStore(filepath, data) {
  const tmp = filepath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, filepath);
}

function generateInboxId() {
  return crypto.randomBytes(4).toString('hex');
}

// ─── Inbox Store Engine ───────────────────────────────────────────────────

class StoreV2 {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.inboxesDir = path.join(baseDir, 'inboxes');
    this.messagesRoot = path.join(baseDir, 'inbox_messages');
    this.seqPath = path.join(baseDir, 'sequence.json');
    this.securityPath = path.join(baseDir, 'security.json');

    ensureDir(this.inboxesDir);
    ensureDir(this.messagesRoot);

    // Load sequence
    this._seq = readStore(this.seqPath);
    if (!this._seq || typeof this._seq.next_id !== 'number') {
      this._seq = { next_id: 1 };
      writeStore(this.seqPath, this._seq);
    }

    // Load security log
    this._security = readStore(this.securityPath) || [];

    // In-memory cache: inbox_id -> inbox record
    this._inboxCache = {};
    this._loadAllInboxes();
  }

  _loadAllInboxes() {
    try {
      for (const f of fs.readdirSync(this.inboxesDir)) {
        if (f.endsWith('.json')) {
          const inboxId = f.replace('.json', '');
          const record = readStore(path.join(this.inboxesDir, f));
          if (record) {
            this._inboxCache[inboxId] = record;
          }
        }
      }
    } catch {}
  }

  _saveInbox(record) {
    const filepath = path.join(this.inboxesDir, `${record.inbox_id}.json`);
    writeStore(filepath, record);
    this._inboxCache[record.inbox_id] = record;
  }

  _saveSeq() { writeStore(this.seqPath, this._seq); }

  _saveSecurity() {
    // Keep last 1000 events
    if (this._security.length > 1000) {
      this._security = this._security.slice(-500);
    }
    writeStore(this.securityPath, this._security);
  }

  nextId() {
    const id = this._seq.next_id++;
    this._saveSeq();
    return id;
  }

  // ─── Inbox Lifecycle ─────────────────────────────────────────────────

  /**
   * Create a new inbox with an automatically generated alias.
   * Returns { inbox_id, alias record }.
   */
  createInbox(agent, purpose, service = 'generic') {
    const inboxId = generateInboxId();
    const aliasValue = `${service}-${crypto.randomBytes(4).toString('hex')}`;

    if (!ALIAS_PATTERN.test(aliasValue)) {
      // Fallback if service name causes issues
      const alt = `in-${crypto.randomBytes(4).toString('hex')}`;
      if (!ALIAS_PATTERN.test(alt)) throw new Error('Alias generation failed');
      aliasValue = alt;
    }

    const nowISO = now();
    const inboxRecord = {
      inbox_id: inboxId,
      agent: agent || 'default',
      purpose: purpose || '',
      service: service || 'generic',
      created_at: nowISO,
      last_access_at: nowISO,
      message_count: 0,
      abuse_score: 0,
      retention_mode: 'ephemeral',     // ephemeral | persistent | archive
      retention_days: 7,               // auto-delete messages older than this
      expired_at: null,                 // set when retention mode transitions
      alias: aliasValue,                // owned alias — one alias per inbox
      disabled_at: null,
      metadata: {},
    };

    // Create the inbox directory
    ensureDir(path.join(this.messagesRoot, inboxId));

    this._saveInbox(inboxRecord);

    return {
      inbox_id: inboxId,
      alias: aliasValue,
      email: `${aliasValue}@inbox.getcourier.dev`,
      created_at: nowISO,
      agent: inboxRecord.agent,
      purpose: inboxRecord.purpose,
      retention_mode: inboxRecord.retention_mode,
    };
  }

  /**
   * Get an inbox by ID.
   */
  getInbox(inboxId) {
    if (!INBOX_ID_PATTERN.test(inboxId)) return null;
    const record = this._inboxCache[inboxId];
    if (!record || record.disabled_at) return null;
    // Touch last_access
    record.last_access_at = now();
    this._saveInbox(record);
    return { ...record };
  }

  /**
   * List all active inboxes (admin).
   */
  listInboxes() {
    return Object.values(this._inboxCache)
      .filter(r => !r.disabled_at)
      .map(r => ({
        inbox_id: r.inbox_id,
        agent: r.agent,
        purpose: r.purpose,
        service: r.service,
        alias: r.alias,
        created_at: r.created_at,
        last_access_at: r.last_access_at,
        message_count: r.message_count,
        abuse_score: r.abuse_score,
        retention_mode: r.retention_mode,
      }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  /**
   * Disable an inbox. Disabled inboxes cannot receive or retrieve messages.
   */
  disableInbox(inboxId) {
    const record = this._inboxCache[inboxId];
    if (!record) return false;
    record.disabled_at = now();
    this._saveInbox(record);
    return true;
  }

  /**
   * Set retention mode for an inbox.
   */
  setRetentionMode(inboxId, mode, days = null) {
    if (!['ephemeral', 'persistent', 'archive'].includes(mode)) {
      throw new Error(`Invalid retention mode: ${mode}. Must be ephemeral, persistent, or archive.`);
    }
    const record = this._inboxCache[inboxId];
    if (!record) throw new Error(`Inbox not found: ${inboxId}`);
    record.retention_mode = mode;
    if (days) record.retention_days = days;
    if (mode === 'ephemeral') {
      // Ephemeral auto-expires after retention_days
      record.expired_at = new Date(Date.now() + record.retention_days * 86400000).toISOString();
    } else {
      record.expired_at = null;
    }
    this._saveInbox(record);
    return {
      inbox_id: inboxId,
      retention_mode: record.retention_mode,
      retention_days: record.retention_days,
      expired_at: record.expired_at,
    };
  }

  // ─── Alias Resolution ────────────────────────────────────────────────

  /**
   * Resolve an email address to an inbox.
   * Returns the inbox record or null if no match.
   */
  resolveAlias(email) {
    const local = (email || '').split('@')[0] || '';
    const aliasKey = local.split('+')[0];

    // Look through all inboxes for matching alias
    for (const record of Object.values(this._inboxCache)) {
      if (record.disabled_at) continue;
      if (record.alias === aliasKey) {
        // Check expiration
        if (record.retention_mode === 'ephemeral' && record.expired_at && record.expired_at < now()) {
          continue; // Expired
        }
        return { ...record };
      }
    }
    return null;
  }

  /**
   * Get the inbox that owns a given alias.
   * Used by ingest to verify the alias exists and is valid.
   */
  resolveAliasToInboxId(email) {
    const local = (email || '').split('@')[0] || '';
    const aliasKey = local.split('+')[0];

    for (const record of Object.values(this._inboxCache)) {
      if (record.disabled_at) continue;
      if (record.alias === aliasKey) {
        if (record.retention_mode === 'ephemeral' && record.expired_at && record.expired_at < now()) {
          return null;
        }
        return record.inbox_id;
      }
    }
    return null;
  }

  // ─── Message Operations ──────────────────────────────────────────────

  _getMsgDir(inboxId) {
    return path.join(this.messagesRoot, inboxId);
  }

  _getMsgPath(inboxId, msgId) {
    return path.join(this.messagesRoot, inboxId, `${msgId}.json`);
  }

  /**
   * Save a message to an inbox.
   */
  saveMessage(inboxId, msg) {
    const inbox = this._inboxCache[inboxId];
    if (!inbox) throw new Error(`Inbox not found: ${inboxId}`);

    const msgDir = this._getMsgDir(inboxId);
    ensureDir(msgDir);

    const filepath = this._getMsgPath(inboxId, msg.id);
    writeStore(filepath, msg);

    inbox.message_count = (inbox.message_count || 0) + 1;
    inbox.last_access_at = now();
    this._saveInbox(inbox);
  }

  /**
   * Get a single message scoped to an inbox.
   */
  getMessage(inboxId, msgId) {
    if (!INBOX_ID_PATTERN.test(inboxId)) return null;
    return readStore(this._getMsgPath(inboxId, msgId));
  }

  /**
   * Get recent messages for an inbox.
   * This is the ONLY retrieval path — no global listing.
   */
  getInboxMessages(inboxId, limit = 20) {
    if (!INBOX_ID_PATTERN.test(inboxId)) return [];
    const inbox = this._inboxCache[inboxId];
    if (!inbox) return [];

    const msgDir = this._getMsgDir(inboxId);
    try {
      const files = fs.readdirSync(msgDir)
        .filter(f => f.endsWith('.json'))
        .sort((a, b) => {
          const aNum = parseInt(a, 10);
          const bNum = parseInt(b, 10);
          return bNum - aNum;
        })
        .slice(0, limit);
      return files.map(f => readStore(path.join(msgDir, f))).filter(Boolean);
    } catch { return []; }
  }

  /**
   * Count recent messages for rate limiting.
   */
  countRecentPerInbox(inboxId) {
    const cutoff = new Date(Date.now() - 3600000).toISOString();
    return this.getInboxMessages(inboxId, 200).filter(m => {
      return m.received_at && m.received_at >= cutoff;
    }).length;
  }

  countRecentGlobal() {
    // Rough estimate by checking a few inboxes
    let total = 0;
    for (const record of Object.values(this._inboxCache)) {
      if (record.disabled_at) continue;
      total += this.countRecentPerInbox(record.inbox_id);
    }
    return total;
  }

  // ─── Security Events ─────────────────────────────────────────────────

  addSecurityEvent(eventType, severity, detail, sourceIP, inboxIdOrAlias) {
    this._security.push({
      id: uuid(),
      event_type: eventType,
      severity,
      detail,
      source_ip: sourceIP,
      inbox_id: inboxIdOrAlias || null,
      created_at: now(),
    });
    this._saveSecurity();
  }

  // ─── Stats ───────────────────────────────────────────────────────────

  getStats() {
    const inboxList = Object.values(this._inboxCache);
    const totalMessages = inboxList.reduce((s, r) => s + (r.message_count || 0), 0);
    // Estimate codes/links from last 20 messages across active inboxes
    let totalCodes = 0, totalLinks = 0;
    for (const record of inboxList.slice(0, 5)) {
      if (record.disabled_at) continue;
      for (const m of this.getInboxMessages(record.inbox_id, 5)) {
        totalCodes += (m.codes || []).length;
        totalLinks += (m.links || []).length;
      }
    }
    return {
      total_inboxes: inboxList.filter(r => !r.disabled_at).length,
      total_messages: totalMessages,
      total_codes: totalCodes,
      total_links: totalLinks,
      total_security: this._security.length,
      security_events: this._security,
    };
  }
}

// ─── Full Inbox Engine ─────────────────────────────────────────────────────

class CourierInboxV2 {
  constructor(dataDir = null) {
    this.store = new StoreV2(dataDir || path.join(__dirname, '..', 'data'));
  }

  /**
   * Ingest a raw email into the correct inbox.
   */
  ingest(rawEmail, envelope = {}) {
    const envelopeTo = envelope.to || 'unknown';
    const sourceIP = envelope.ip || '0.0.0.0';

    // 1. Size check
    if (Buffer.byteLength(rawEmail, 'utf-8') > MAX_MESSAGE_SIZE) {
      this.store.addSecurityEvent('oversized_message', 'warn', `Message too large`, sourceIP, envelopeTo);
      return { error: 'Message exceeds maximum size', ingested: false };
    }

    // 2. Global rate limit check
    if (this.store.countRecentGlobal() >= RATE_LIMIT_HOUR) {
      this.store.addSecurityEvent('rate_limit', 'warn', 'Global rate limit hit', sourceIP, envelopeTo);
      return { error: 'Rate limit exceeded', ingested: false };
    }

    // 3. Resolve alias to inbox
    const inboxId = this.store.resolveAliasToInboxId(envelopeTo);
    if (!inboxId) {
      this.store.addSecurityEvent('unresolved_alias', 'info', `No inbox for: ${envelopeTo}`, sourceIP, envelopeTo);
      return { error: 'No matching inbox', ingested: false };
    }

    const inbox = this.store.getInbox(inboxId);
    if (!inbox) {
      return { error: 'Inbox disabled or expired', ingested: false };
    }

    // 4. Per-inbox rate limit
    if (this.store.countRecentPerInbox(inboxId) >= RATE_LIMIT_RECIPIENT_HOUR) {
      this.store.addSecurityEvent('rate_limit_recipient', 'warn', `Inbox rate limit: ${inboxId}`, sourceIP, inboxId);
      return { error: 'Inbox rate limit exceeded', ingested: false };
    }

    // 5. Parse
    const parsed = parseEmail(rawEmail);

    // 6. Classify
    const classification = classifyEmail(parsed);

    // 7. Extract
    const extracted = extractVerifications(parsed.text_body, parsed.html_body);

    // 8. Store in inbox-scoped namespace
    const msgId = this.store.nextId();
    const msg = {
      id: msgId,
      inbox_id: inboxId,
      message_id: parsed.message_id || uuid(),
      alias: inbox.alias,
      envelope_from: envelope.from || 'unknown',
      envelope_to: envelopeTo,
      subject: parsed.subject,
      from_name: parsed.from_name,
      from_addr: parsed.from_addr,
      to_name: parsed.to_name,
      to_addr: parsed.to_addr,
      reply_to: parsed.reply_to,
      date: parsed.date,
      raw_size: parsed.raw_size,
      text_body: parsed.text_body ? parsed.text_body.substring(0, 10000) : '',
      html_body: parsed.html_body ? parsed.html_body.substring(0, 100000) : null,
      has_attachments: parsed.has_attachments,
      attachments_json: JSON.stringify(parsed.attachments),
      classification: classification.service,
      classification_confidence: classification.confidence,
      codes: extracted.codes,
      links: extracted.links,
      received_at: now(),
    };
    this.store.saveMessage(inboxId, msg);

    this.store.addSecurityEvent('ingested', 'info', `Message ${msgId} -> inbox ${inboxId}`, sourceIP, inboxId);

    return {
      message_id: msgId,
      inbox_id: inboxId,
      ingested: true,
      classification: classification.service,
      confidence: classification.confidence,
      codes_found: extracted.codes.length,
      links_found: extracted.links.length,
    };
  }

  // ─── Inbox API ───────────────────────────────────────────────────────

  createInbox(agent, purpose, service) {
    const result = this.store.createInbox(agent, purpose, service);
    return {
      inbox_id: result.inbox_id,
      alias: result.alias,
      email: result.email,
      agent: result.agent,
      purpose: result.purpose,
      created_at: result.created_at,
      retention_mode: result.retention_mode,
    };
  }

  getInbox(inboxId) {
    return this.store.getInbox(inboxId);
  }

  listInboxes() {
    return this.store.listInboxes();
  }

  disableInbox(inboxId) {
    return this.store.disableInbox(inboxId);
  }

  setRetentionMode(inboxId, mode, days) {
    return this.store.setRetentionMode(inboxId, mode, days);
  }

  // ─── Message Retrieval (SCOPED) ──────────────────────────────────────

  getInboxMessages(inboxId, limit) {
    return this.store.getInboxMessages(inboxId, limit);
  }

  getMessage(inboxId, msgId) {
    return this.store.getMessage(inboxId, msgId);
  }

  stats() {
    return this.store.getStats();
  }

  // ─── Legacy Alias Management (wraps inbox) ───────────────────────────

  createAlias(purpose, service, agentId) {
    // Legacy: createAlias now creates an inbox with that alias
    return this.createInbox(agentId, purpose, service);
  }

  listAliases() {
    return this.store.listInboxes();
  }

  resolveAlias(email) {
    const inbox = this.store.resolveAlias(email);
    if (!inbox) return null;
    // Return in the legacy format for compatibility
    return {
      alias: inbox.alias,
      purpose: inbox.purpose,
      service: inbox.service,
      agent_id: inbox.agent,
      is_catch_all: 0,
      created_at: inbox.created_at,
      disabled_at: inbox.disabled_at,
    };
  }

  disableAlias(aliasValue) {
    // Find inbox by alias value and disable
    for (const record of Object.values(this.store._inboxCache)) {
      if (record.alias === aliasValue) {
        return this.store.disableInbox(record.inbox_id);
      }
    }
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Legacy Parser Functions (unchanged from v1)
// ═══════════════════════════════════════════════════════════════════════════

function parseEmail(rawBody) {
  if (rawBody) rawBody = rawBody.replace(/\r\n/g, "\n");
  const result = {
    headers: {},
    subject: '', from_name: '', from_addr: '', to_name: '', to_addr: '',
    reply_to: '', date: '', message_id: '', text_body: '', html_body: '',
    attachments: [], raw_size: 0, has_attachments: 0,
  };

  if (!rawBody) return result;
  result.raw_size = Buffer.byteLength(rawBody, 'utf-8');

  const headerEnd = rawBody.indexOf('\n\n');
  if (headerEnd === -1) return result;

  const headerSection = rawBody.substring(0, headerEnd);
  const bodySection = rawBody.substring(headerEnd + 2);

  const headers = {};
  let currentKey = '';
  for (const line of headerSection.split('\n')) {
    if (/^\s/.test(line) && currentKey) {
      headers[currentKey] += ' ' + line.trim();
    } else {
      const colon = line.indexOf(':');
      if (colon > 0) {
        currentKey = line.substring(0, colon).trim().toLowerCase();
        headers[currentKey] = line.substring(colon + 1).trim();
      }
    }
  }
  result.headers = headers;
  result.subject = headers['subject'] || '';
  result.message_id = (headers['message-id'] || '').replace(/[<>]/g, '');
  result.date = headers['date'] || '';
  result.reply_to = headers['reply-to'] || '';

  const from = headers['from'] || '';
  const fm = from.match(/^(?:"?([^"]*)"?\s*)?<([^>]+)>/) || from.match(/^([^\s@]+@[^\s]+)/);
  if (fm) { result.from_name = (fm[1] || '').trim(); result.from_addr = fm[2] || fm[1] || ''; }
  else { result.from_addr = from; }

  const to = headers['to'] || '';
  const tm = to.match(/^(?:"?([^"]*)"?\s*)?<([^>]+)>/) || to.match(/^([^\s@]+@[^\s]+)/);
  if (tm) { result.to_name = tm[1] || ''; result.to_addr = tm[2] || tm[1] || ''; }
  else { result.to_addr = to; }

  const ct = headers['content-type'] || '';
  if (ct.includes('multipart')) {
    const boundary = ct.match(/boundary="?([^";]+)"?/);
    if (boundary) {
      const parts = bodySection.split('--' + boundary[1]);
      for (const part of parts) {
        const pHdrEnd = part.indexOf('\n\n');
        if (pHdrEnd < 0) continue;
        const partBody = part.substring(pHdrEnd + 2);
        if (part.includes('text/plain') && !part.includes('text/html') && !result.text_body) {
          result.text_body = partBody.trim();
        } else if (part.includes('text/html') && !result.html_body) {
          result.html_body = partBody.trim();
        }
        if ((part.includes('application/') || part.includes('octet-stream')) && !part.includes('text/plain')) {
          result.attachments.push({ name: 'attachment', size: Buffer.byteLength(partBody, 'utf-8') });
          result.has_attachments = 1;
        }
      }
    }
  } else if (ct.includes('text/html')) {
    result.html_body = bodySection.trim();
    result.text_body = bodySection.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  } else {
    result.text_body = bodySection.trim();
  }

  if (result.attachments.length > MAX_ATTACHMENTS) result.attachments = result.attachments.slice(0, MAX_ATTACHMENTS);
  return result;
}

function extractVerifications(text, html) {
  const combined = text + '\n' + (html ? html.replace(/<[^>]*>/g, ' ') : '');
  const codes = [];
  const links = [];

  // 6-digit codes
  const sixDigitRe = /(?<!\d)(\d{6})(?!\d)/g;
  let m;
  while ((m = sixDigitRe.exec(combined)) !== null) {
    const before = combined[m.index - 1] || ' ';
    const after = combined[m.index + 6] || ' ';
    if (/\d/.test(before) || /\d/.test(after)) continue;
    if (m[1] === '000000' || m[1] === '123456') continue;
    const context = combined.substring(Math.max(0, m.index - 30), m.index + 36);
    codes.push({ code: m[1], type: '6-digit', context: context.trim() });
  }

  // 8-digit codes
  const eightDigitRe = /(?<!\d)(\d{8})(?!\d)/g;
  while ((m = eightDigitRe.exec(combined)) !== null) {
    const before = combined[m.index - 1] || ' ';
    const after = combined[m.index + 8] || ' ';
    if (/\d/.test(before) || /\d/.test(after)) continue;
    if (m[1] === '00000000') continue;
    const context = combined.substring(Math.max(0, m.index - 30), m.index + 38);
    codes.push({ code: m[1], type: '8-digit', context: context.trim() });
  }

  // Hyphenated alphanumeric tokens
  const hyphenTokenRe = /\b([A-Z0-9]{2,8}(?:-[A-Z0-9]{2,8}){1,4})\b/g;
  while ((m = hyphenTokenRe.exec(combined)) !== null) {
    const token = m[1];
    if (token.length < 5 || token.length > 40) continue;
    if (/^[0-9]+-[0-9]+$/.test(token) && token.length < 8) continue;
    const context = combined.substring(Math.max(0, m.index - 20), m.index + token.length + 20);
    codes.push({ code: token, type: 'token', context: context.trim() });
  }

  // Short alphanumeric tokens
  const shortTokenRe = /\b(?![0-9]+\b)(?=[A-Za-z]*[0-9])(?=[0-9A-Za-z]{4,12}\b)[A-Za-z0-9]+\b/g;
  while ((m = shortTokenRe.exec(combined)) !== null) {
    const token = m[0];
    if (/^(https?|ftp|www|email|code|token|key|auth|pass|login|user|test)$/i.test(token)) continue;
    const context = combined.substring(Math.max(0, m.index - 20), m.index + token.length + 20);
    codes.push({ code: token, type: 'mixed', context: context.trim() });
  }

  // Links
  const linkRe = /https?:\/\/[^\s<>"']+/g;
  const linkTypes = {
    'verify': 'verification', 'magic': 'magic_link', 'magic-link': 'magic_link', 'magiclink': 'magic_link',
    'reset': 'password_reset', 'reset-password': 'password_reset', 'resetpassword': 'password_reset',
    'confirm': 'verification', 'activation': 'verification', 'validate': 'verification',
    'email-verify': 'verification', 'email_verify': 'verification',
    'github.com/login': 'verification', 'npmjs.com/verify': 'verification',
    'password-reset': 'password_reset', 'forgot-password': 'password_reset', 'forgotpassword': 'password_reset',
    'login/magic': 'magic_link', 'magic-link': 'magic_link', 'session/magic': 'magic_link',
    'confirm-email': 'verification', 'confirm_email': 'verification', 'activate': 'verification',
    'authorize': 'verification', 'device': 'verification', '2fa': 'verification',
  };

  function classifyByPath(u) {
    const path = u.pathname.toLowerCase();
    if (/\/verify\//.test(path) || /\/verify$/.test(path)) return 'verification';
    if (/\/reset\//.test(path) || /\/reset-password/.test(path)) return 'password_reset';
    if (/\/magic/.test(path) || /\/device\//.test(path)) return 'magic_link';
    if (/\/confirm/.test(path) || /\/activate/.test(path)) return 'verification';
    if (/\/auth\//.test(path) || /\/login\//.test(path)) return 'verification';
    if (u.searchParams.has('token') || u.searchParams.has('code') || u.searchParams.has('key')) return 'verification';
    if (u.searchParams.has('reset') || u.searchParams.has('recovery')) return 'password_reset';
    return null;
  }

  while ((m = linkRe.exec(combined)) !== null) {
    const url = m[0];
    try {
      const u = new URL(url);
      let linkType = 'generic';
      let isVerification = 0, isReset = 0, isMagic = 0;
      for (const [keyword, type] of Object.entries(linkTypes)) {
        if (url.toLowerCase().includes(keyword)) {
          linkType = type;
          if (type === 'verification') isVerification = 1;
          if (type === 'password_reset') isReset = 1;
          if (type === 'magic_link') isMagic = 1;
          break;
        }
      }
      if (linkType === 'generic') {
        const pathType = classifyByPath(u);
        if (pathType) {
          linkType = pathType;
          if (pathType === 'verification') isVerification = 1;
          if (pathType === 'password_reset') isReset = 1;
          if (pathType === 'magic_link') isMagic = 1;
        }
      }
      links.push({
        url: url.substring(0, 500), type: linkType, domain: u.hostname, path: u.pathname,
        is_verification: isVerification, is_password_reset: isReset, is_magic_link: isMagic,
      });
    } catch {}
  }

  // Deduplicate
  const seenCodes = new Set();
  const codesDeduped = codes.filter(c => { const k = `${c.code}:${c.type}`; if (seenCodes.has(k)) return false; seenCodes.add(k); return true; });
  const seenLinks = new Set();
  const linksDeduped = links.filter(l => { const k = l.url.substring(0, 200); if (seenLinks.has(k)) return false; seenLinks.add(k); return true; });

  return { codes: codesDeduped, links: linksDeduped };
}

function classifyEmail(parsed) {
  const text = (parsed.text_body || '').toLowerCase();
  const from = (parsed.from_addr || '').toLowerCase();
  const subject = (parsed.subject || '').toLowerCase();
  const body = text + subject;

  if (from.includes('github') || body.includes('github') || from.includes('noreply@github')) return { service: 'github', confidence: 0.9 };
  if (from.includes('npm') || body.includes('npmjs') || from.includes('@npm')) return { service: 'npm', confidence: 0.85 };
  if (from.includes('cloudflare') || body.includes('cloudflare')) return { service: 'cloudflare', confidence: 0.85 };
  if (from.includes('notion') || body.includes('notion')) return { service: 'notion', confidence: 0.8 };
  if (from.includes('slack') || body.includes('slack')) return { service: 'slack', confidence: 0.8 };
  if (from.includes('google') || from.includes('accounts.google') || body.includes('google')) return { service: 'google', confidence: 0.7 };
  if (body.includes('verify') || body.includes('confirm') || body.includes('reset your password')) return { service: 'verification_platform', confidence: 0.5 };
  return { service: 'unknown', confidence: 0.3 };
}

module.exports = { CourierInboxV2, parseEmail, extractVerifications, classifyEmail };
