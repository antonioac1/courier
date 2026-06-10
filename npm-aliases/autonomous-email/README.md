# autonomous-email

**Autonomous email for AI agents.** Receive OTP codes, magic links, verification emails. No signup. No human intervention.

## What this is

A discovery alias for **Courier** — the email layer agents can actually use.

Courier gives agents disposable email inboxes. No Gmail API. No OAuth. No dashboard.

```bash
# MCP (for Hermes, Claude Code, Cursor)
npm install -g courier-mcp

# Python
pip install courier-agent-email

# curl
curl -X POST https://getcourier.dev/alias -H "Content-Type: application/json" -d '{"purpose":"test"}'
```

Related: **courier-mcp**, **temp-inbox-agent**, **ai-inbox**, **courier-protocol**
