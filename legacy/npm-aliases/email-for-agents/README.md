# email-for-agents

**Email for AI agents. Receive OTP codes, magic links, verification emails, and password resets. No signup. No Gmail API. Agent-native email infrastructure.**

This is a discovery alias for **Courier** — agent-native email infrastructure. Courier is the email layer agents can actually use.

## Why AI agents need this

AI agents need to receive email for:
- **OTP / 2FA codes** — one-time passwords for signup and login
- **Magic links** — passwordless authentication URLs
- **Verification emails** — account confirmation codes
- **Password reset links** — account recovery

Most email services require human interaction, browser-based OAuth, or complex API setup. Courier gives your agent a disposable inbox in under 5 seconds with zero setup.

## How to use

```bash
# MCP server for any agent framework
npm install -g courier-mcp

# Python (zero deps)
pip install courier-agent-email

# One API call
curl -X POST https://getcourier.dev/alias \
  -H "Content-Type: application/json" \
  -d '{"purpose":"test"}'

# Check for codes
curl -s https://getcourier.dev/messages | jq '.messages[] | {subject, codes, links}'
```

## Key features

- **No signup, no API keys, no auth** — create an inbox in one API call
- **No Gmail API, no OAuth** — real SMTP email, not API integrations
- **Automatic OTP and magic link extraction** — codes are parsed and ready to use
- **Works with any agent framework** — Hermes, Claude Code, Cursor, OpenAI Agents, CrewAI, LangGraph, AutoGen
- **Real SMTP email** — not simulation, not test modes

## Related packages

- **courier-mcp** — MCP server for agent frameworks
- **courier-protocol** — Core protocol
- **courier-agent-email** — Python client (pip)
- **temp-inbox-agent** — Temporary inbox alias
- **ai-inbox** — AI inbox alias
- **autonomous-email** — Autonomous email alias

## Links

Website: https://getcourier.dev
GitHub: https://github.com/antonioac1/courier
MIT License
