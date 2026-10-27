#!/usr/bin/env node
'use strict';

/**
 * getcourier CLI
 *
 *   npx getcourier                       # create an inbox, print address + read_token
 *   getcourier new [--wait] [--purpose P] [--agent A] [--alias A] [--timeout S]
 *   getcourier wait <alias> --token T [--timeout 120] [--after MSG_ID]
 *   getcourier --help
 *
 * JSON goes to stdout, errors to stderr, non-zero exit on error.
 */

const { createInbox, waitForCode, CourierError, VERSION } = require('../index.js');

const DEFAULT_WAIT_TIMEOUT = 120;

const USAGE = `getcourier ${VERSION} — email inboxes for AI agents (getcourier.dev)

Usage:
  getcourier                          Create an inbox; prints address + read_token as JSON
  getcourier new [options]            Same as above, with options
  getcourier wait <alias> --token T   Long-poll for a verification code or magic link
  getcourier --help                   Show this help

Options:
  --wait                 (new) wait for the first code/link after creating the inbox
  --purpose <text>       What the inbox is for (<= 200 chars)
  --agent <name>         Agent name (<= 100 chars)
  --alias <name>         Requested alias; a 6-char suffix is appended
  --token, -t <token>    read_token for the inbox (required by \`wait\`)
  --timeout <seconds>    Total wait time (default ${DEFAULT_WAIT_TIMEOUT})
  --after <message_id>   Only consider messages newer than this id
  -h, --help             Show this help

Environment:
  GETCOURIER_BASE_URL    Override the API base (default https://getcourier.dev)

Examples:
  npx getcourier
  npx getcourier new --purpose "signup" --wait --timeout 90
  npx getcourier wait my-agent-k3xmqz --token rt_... --timeout 120

MCP alternative (no install, no token juggling):
  claude mcp add --transport http getcourier https://getcourier.dev/mcp
`;

const COMMANDS = new Set(['new', 'create', 'wait', 'help']);

function parseArgs(argv = []) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  const parsed = {
    command: null,
    alias: null,
    token: null,
    timeout: null,
    after: null,
    purpose: null,
    agent: null,
    wait: false,
    help: false,
  };

  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h' || arg === 'help') {
      parsed.help = true;
      continue;
    }
    if (arg === '--wait' || arg === '-w') {
      parsed.wait = true;
      continue;
    }
    if (arg === '--token' || arg === '-t') {
      parsed.token = args[++i];
      continue;
    }
    if (arg.startsWith('--token=')) {
      parsed.token = arg.slice('--token='.length);
      continue;
    }
    if (arg === '--timeout' || arg === '-T') {
      parsed.timeout = args[++i];
      continue;
    }
    if (arg.startsWith('--timeout=')) {
      parsed.timeout = arg.slice('--timeout='.length);
      continue;
    }
    if (arg === '--after') {
      parsed.after = args[++i];
      continue;
    }
    if (arg.startsWith('--after=')) {
      parsed.after = arg.slice('--after='.length);
      continue;
    }
    if (arg === '--purpose') {
      parsed.purpose = args[++i];
      continue;
    }
    if (arg.startsWith('--purpose=')) {
      parsed.purpose = arg.slice('--purpose='.length);
      continue;
    }
    if (arg === '--agent') {
      parsed.agent = args[++i];
      continue;
    }
    if (arg.startsWith('--agent=')) {
      parsed.agent = arg.slice('--agent='.length);
      continue;
    }
    if (arg === '--alias' || arg === '-a') {
      parsed.alias = args[++i];
      continue;
    }
    if (arg.startsWith('--alias=')) {
      parsed.alias = arg.slice('--alias='.length);
      continue;
    }
    if (arg.startsWith('-') && arg !== '-') {
      throw new CourierError(`Unknown option: ${arg}. Run \`getcourier --help\`.`, { code: 'BAD_ARGS' });
    }
    positional.push(arg);
  }

  if (positional.length && COMMANDS.has(positional[0])) {
    parsed.command = positional[0] === 'create' ? 'new' : positional[0];
    positional.shift();
    if (parsed.command === 'help') parsed.help = true;
  }

  // A trailing positional after `new` is not an alias (avoid surprises); for
  // `wait` the first positional is the alias.
  if (!parsed.command && positional.length === 0) parsed.command = 'new';
  if (parsed.command === 'wait' && positional.length) parsed.alias = parsed.alias || positional.shift();

  if (parsed.timeout != null) {
    const seconds = Number(parsed.timeout);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new CourierError(`Invalid --timeout: ${parsed.timeout} (expected seconds > 0).`, { code: 'BAD_ARGS' });
    }
    parsed.timeout = seconds;
  }

  return parsed;
}

function inboxJson(inbox) {
  return {
    address: inbox.address,
    alias: inbox.alias,
    inbox_id: inbox.inboxId,
    read_token: inbox.readToken,
    expires_at: inbox.expiresAt,
    ttl_hours: inbox.ttlHours,
    paid: inbox.paid,
  };
}

async function main(argv = process.argv.slice(2), io = {}) {
  const stdout = io.stdout || ((line) => process.stdout.write(String(line)));
  const stderr = io.stderr || ((line) => process.stderr.write(String(line)));
  const emit = (obj) => stdout(`${JSON.stringify(obj, null, 2)}\n`);
  const fail = (message, code) => {
    stderr(`getcourier: ${message}\n`);
    return code;
  };

  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    fail(err.message, 2);
    return 2;
  }

  if (args.help || args.command === 'help') {
    stdout(USAGE);
    return 0;
  }

  try {
    if (args.command === 'wait') {
      if (!args.alias) {
        fail('missing <alias>. Usage: getcourier wait <alias> --token <read_token>', 2);
        return 2;
      }
      if (!args.token) {
        fail('missing --token <read_token>. Usage: getcourier wait <alias> --token <read_token>', 2);
        return 2;
      }
      const result = await waitForCode(args.alias, {
        token: args.token,
        timeoutSeconds: args.timeout || DEFAULT_WAIT_TIMEOUT,
        after: args.after || undefined,
        fetch: io.fetch,
      });
      if (result.timeout || !result.message) {
        emit({ code: null, link: null, timeout: true });
        fail(`timed out after ${args.timeout || DEFAULT_WAIT_TIMEOUT}s waiting for a message with a code or link`, 3);
        return 3;
      }
      emit({ code: result.code, link: result.link, timeout: false, message: result.message });
      return 0;
    }

    // default / `new`
    const inbox = await createInbox({
      alias: args.alias || undefined,
      purpose: args.purpose || undefined,
      agent: args.agent || undefined,
      fetch: io.fetch,
    });

    if (!args.wait) {
      emit(inboxJson(inbox));
      return 0;
    }

    const result = await waitForCode(inbox, {
      timeoutSeconds: args.timeout || DEFAULT_WAIT_TIMEOUT,
      after: args.after || undefined,
      fetch: io.fetch,
    });
    emit({
      ...inboxJson(inbox),
      code: result.code,
      link: result.link,
      timeout: result.timeout,
      message: result.message,
    });
    if (result.timeout) {
      fail(`inbox ${inbox.address} created, but no code/link arrived within ${args.timeout || DEFAULT_WAIT_TIMEOUT}s`, 3);
      return 3;
    }
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = err && err.code ? ` [${err.code}]` : '';
    fail(`${message}${code}`, 1);
    if (err instanceof CourierError && err.retryAfter != null) {
      stderr(`getcourier: retry after ${err.retryAfter}s\n`);
    }
    return 1;
  }
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  });
}

module.exports = { main, parseArgs, USAGE, DEFAULT_WAIT_TIMEOUT };
