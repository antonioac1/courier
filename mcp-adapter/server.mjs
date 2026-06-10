#!/usr/bin/env node

/**
 * courier-mcp — MCP server for Courier
 * 
 * Give your AI agent an email inbox in under 5 seconds.
 * Zero npm dependencies. Uses native Node.js fetch + readline.
 * 
 * MCP Tools:
 *   create_inbox     — Create a disposable email inbox (no signup)
 *   get_inbox        — Check an inbox for received emails
 *   wait_for_email   — Poll until an email arrives (auto-retry)
 *   extract_otp      — Extract verification codes from inbox
 *   extract_magic_link — Extract magic links from inbox
 */

const API = process.env.COURIER_API || 'https://getcourier.dev';

// ─── MCP Protocol Helpers ──────────────────────────────────────────────

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }

async function handleRequest(req) {
  const { method, params, id } = req;

  if (method === 'initialize') {
    return {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'courier-mcp', version: '0.1.0' }
    };
  }

  if (method === 'tools/list') {
    return {
      tools: [
        {
          name: 'create_inbox',
          description: 'Create a new disposable email inbox for an AI agent. No signup, no auth.',
          inputSchema: {
            type: 'object',
            properties: {
              purpose: { type: 'string', description: 'Why this inbox is needed (e.g. "signup", "verification")' },
              agent: { type: 'string', description: 'Agent identifier' }
            }
          }
        },
        {
          name: 'get_inbox',
          description: 'Check an inbox for received emails and their contents.',
          inputSchema: {
            type: 'object',
            properties: {
              inbox: { type: 'string', description: 'Inbox address or alias name' }
            },
            required: ['inbox']
          }
        },
        {
          name: 'wait_for_email',
          description: 'Poll an inbox until a new email arrives or timeout. Handles delayed delivery.',
          inputSchema: {
            type: 'object',
            properties: {
              inbox: { type: 'string', description: 'Inbox address or alias name' },
              timeout: { type: 'number', description: 'Max wait in ms (default: 60000)' },
              check_interval: { type: 'number', description: 'Poll interval in ms (default: 3000)' }
            },
            required: ['inbox']
          }
        },
        {
          name: 'extract_otp',
          description: 'Extract all verification codes (OTP, 2FA, verification codes) from inbox emails.',
          inputSchema: {
            type: 'object',
            properties: {
              inbox: { type: 'string', description: 'Inbox address or alias name' }
            },
            required: ['inbox']
          }
        },
        {
          name: 'extract_magic_link',
          description: 'Extract all magic links and verification URLs from inbox emails.',
          inputSchema: {
            type: 'object',
            properties: {
              inbox: { type: 'string', description: 'Inbox address or alias name' }
            },
            required: ['inbox']
          }
        }
      ]
    };
  }

  if (method === 'tools/call') {
    const tool = params.name;
    const args = params.arguments || {};
    let result;

    try {
      switch (tool) {
        case 'create_inbox': {
          const body = {};
          if (args.purpose) body.purpose = args.purpose;
          if (args.agent) body.agent = args.agent;
          const res = await fetch(`${API}/alias`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          const data = await res.json();
          if (data.error) throw new Error(data.message || data.error);
          result = {
            inbox: data.alias?.alias || data.alias,
            email: `${data.alias?.alias || data.alias}@mail.getcourier.dev`,
            status: 'ready'
          };
          break;
        }

        case 'get_inbox': {
          const res = await fetch(`${API}/messages?limit=50`);
          const data = await res.json();
          if (data.error) throw new Error(data.message || data.error);
          result = {
            inbox: args.inbox,
            email_count: (data.messages || []).length,
            emails: (data.messages || []).map(m => ({
              id: m.id,
              from: m.from,
              subject: m.subject,
              classification: m.classification,
              codes: m.codes || [],
              links: m.links || [],
              received_at: m.received_at
            }))
          };
          break;
        }

        case 'wait_for_email': {
          const timeout = args.timeout || 60000;
          const interval = args.check_interval || 3000;
          const start = Date.now();
          let data = null;
          
          while (Date.now() - start < timeout) {
            const res = await fetch(`${API}/messages?limit=50`);
            data = await res.json();
            if (data.messages && data.messages.length > 0) {
              break;
            }
            await new Promise(r => setTimeout(r, interval));
          }

          if (!data || !data.messages || data.messages.length === 0) {
            throw new Error('Timeout waiting for email after ' + (timeout/1000) + 's');
          }

          result = {
            emails: (data.messages || []).map(m => ({
              id: m.id,
              from: m.from,
              subject: m.subject,
              classification: m.classification,
              codes: m.codes || [],
              links: m.links || [],
              received_at: m.received_at
            })),
            waited_ms: Date.now() - start
          };
          break;
        }

        case 'extract_otp': {
          const res = await fetch(`${API}/messages?limit=50`);
          const data = await res.json();
          if (data.error) throw new Error(data.message || data.error);
          const allCodes = [];
          for (const msg of (data.messages || [])) {
            for (const c of (msg.codes || [])) {
              allCodes.push({ code: c.code, type: c.type, from_subject: msg.subject });
            }
          }
          result = { codes: allCodes, email_count: (data.messages || []).length };
          break;
        }

        case 'extract_magic_link': {
          const res = await fetch(`${API}/messages?limit=50`);
          const data = await res.json();
          if (data.error) throw new Error(data.message || data.error);
          const allLinks = [];
          for (const msg of (data.messages || [])) {
            for (const l of (msg.links || [])) {
              allLinks.push({ url: l.url, type: l.type, domain: l.domain, from_subject: msg.subject });
            }
          }
          result = { links: allLinks, email_count: (data.messages || []).length };
          break;
        }

        default:
          return { error: { code: -32601, message: `Tool not found: ${tool}` } };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    } catch (e) {
      return { error: { code: -32000, message: e.message } };
    }
  }

  return null;
}

// ─── Main Loop ──────────────────────────────────────────────────────────

import { createInterface } from 'readline';

const rl = createInterface({ input: process.stdin });
for await (const line of rl) {
  try {
    const req = JSON.parse(line);
    const result = await handleRequest(req);
    if (result) {
      if (result.error) {
        send({ jsonrpc: '2.0', error: result.error, id: req.id });
      } else {
        send({ jsonrpc: '2.0', result, id: req.id });
      }
    } else {
      send({ jsonrpc: '2.0', result: null, id: req.id });
    }
  } catch (e) {
    send({ jsonrpc: '2.0', error: { code: -32700, message: e.message }, id: null });
  }
}
