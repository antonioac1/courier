# temp-inbox-agent

**Temporary email inboxes for AI agents.**

Agents need email to receive OTP codes, magic links, and verification emails.
Courier gives your agent a disposable inbox in under 5 seconds. No signup.

## What this package does

This is a discovery alias for **Courier** — the email layer agents can actually use.

Courier is **not** a notification service, not an outbound email platform, and not Gmail.
It is **agent-native email**: disposable inboxes that receive real SMTP mail and
automatically extract OTP codes, magic links, and verification URLs.

## How to use

```bash
# Install the MCP server (for Hermes, Claude Code, Cursor)
npm install -g courier-mcp

# Python (zero deps)
pip install courier-agent-email

# Or just use curl
curl -X POST https://getcourier.dev/alias -H "Content-Type: application/json" -d '{"purpose":"test"}'
curl -s https://getcourier.dev/messages | jq '.messages[] | {subject, codes, links}'
```

## Why agents need this

- Receive OTP / 2FA codes for autonomous signup
- Receive magic links for passwordless login
- Receive password reset links for account recovery
- Receive verification emails for account confirmation
- No Gmail API, no OAuth, no human intervention

## Related packages

- **courier-mcp** — MCP server for agent frameworks
- **courier-protocol** — Core protocol package
- **ai-inbox** — Alternative discovery alias
- **autonomous-email** — Alternative discovery alias
- **courier-agent-email** — PyPI package (`pip install`)

## Links

Website: https://getcourier.dev
GitHub: https://github.com/antonioac1/courier
