#!/usr/bin/env node

/**
 * Courier - Email for AI Agents
 * Single-file Node.js client. Zero dependencies (node built-ins only).
 * 
 * Give your agent an email inbox in under 5 seconds.
 * 
 * Usage:
 *   import { Courier } from './courier.mjs';
 *   const c = new Courier();
 *   const inbox = await c.createInbox();
 *   const msg = await c.waitForEmail(inbox, 60000);
 *   const code = await c.extractOTP();
 *   const link = await c.extractMagicLink();
 */

const BASE = process.env.COURIER_API || 'https://getcourier.dev';

export class Courier {
  async createInbox(purpose = 'agent', agent = 'default') {
    const res = await fetch(`${BASE}/alias`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ purpose, agent })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.message || data.error);
    return {
      inbox: data.alias?.alias || data.alias,
      email: `${data.alias?.alias || data.alias}@mail.getcourier.dev`,
      raw: data
    };
  }

  async getMessages(limit = 50) {
    const res = await fetch(`${BASE}/messages?limit=${limit}`);
    return res.json();
  }

  async waitForEmail(timeout = 60000, checkInterval = 3000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const data = await this.getMessages();
      const msgs = data.messages || [];
      if (msgs.length > 0) return msgs[0];
      await new Promise(r => setTimeout(r, checkInterval));
    }
    throw new Error(`No email after ${timeout / 1000}s`);
  }

  async extractOTP() {
    const data = await this.getMessages();
    const codes = [];
    for (const msg of (data.messages || [])) {
      for (const c of (msg.codes || [])) {
        codes.push({ code: c, subject: msg.subject, from: msg.from });
      }
    }
    return codes;
  }

  async extractMagicLink() {
    const data = await this.getMessages();
    const links = [];
    for (const msg of (data.messages || [])) {
      for (const l of (msg.links || [])) {
        links.push({ link: l, subject: msg.subject, from: msg.from });
      }
    }
    return links;
  }
}

// --- CLI ---

if (process.argv[1] === import.meta.url || process.argv[1]?.endsWith('courier.mjs')) {
  const c = new Courier();
  const cmd = process.argv[2];

  if (!cmd) {
    console.log('Usage: node courier.mjs [create|messages|wait|otp|link]');
    process.exit(1);
  }

  const main = async () => {
    switch (cmd) {
      case 'create': {
        const r = await c.createInbox();
        console.log(`Inbox created: ${r.inbox}`);
        console.log(`Email: ${r.email}`);
        break;
      }
      case 'messages': {
        const data = await c.getMessages();
        console.log(`${(data.messages || []).length} messages`);
        for (const m of (data.messages || []).slice(0, 5)) {
          console.log(`  [${m.id}] ${m.subject || 'no subject'}`);
        }
        break;
      }
      case 'wait': {
        const timeout = parseInt(process.argv[3] || '60') * 1000;
        console.log(`Waiting for email (timeout=${timeout / 1000}s)...`);
        try {
          const msg = await c.waitForEmail(timeout);
          console.log(`Email received!`);
          console.log(`   From: ${msg.from}`);
          console.log(`   Subject: ${msg.subject}`);
          console.log(`   Codes: ${JSON.stringify(msg.codes || [])}`);
          console.log(`   Links: ${JSON.stringify(msg.links || [])}`);
        } catch (e) {
          console.log(`Error: ${e.message}`);
          process.exit(1);
        }
        break;
      }
      case 'otp': {
        const codes = await c.extractOTP();
        if (codes.length > 0) {
          console.log(`${codes.length} code(s) found:`);
          for (const c of codes) console.log(`   ${c.code} (from: ${c.subject})`);
        } else {
          console.log('No codes found');
        }
        break;
      }
      case 'link': {
        const links = await c.extractMagicLink();
        if (links.length > 0) {
          console.log(`${links.length} link(s) found:`);
          for (const l of links) console.log(`   ${l.link} (from: ${l.subject})`);
        } else {
          console.log('No links found');
        }
        break;
      }
    }
  };
  main().catch(e => { console.error(e.message); process.exit(1); });
}
