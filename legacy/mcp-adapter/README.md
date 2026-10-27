# courier-mcp

**MCP server for AI agent email.** Create disposable inboxes, receive OTP codes, extract magic links, handle verification emails.

For Hermes, Claude Code, Cursor, and any MCP-compatible agent framework.

## Quick start

```bash
npm install -g courier-mcp
```

Then add to your MCP config:
```json
{
  "mcpServers": {
    "courier": {
      "command": "courier-mcp"
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `create_inbox` | Create a temporary email inbox. No signup. |
| `wait_for_email` | Poll until an email arrives. Auto-retry. |
| `extract_otp` | Get verification codes from inbox. |
| `extract_magic_link` | Get magic links from inbox. |
| `get_inbox` | Check inbox contents. |

## Why agents need this

AI agents can't use Gmail. They can't do OAuth flows. They can't click "verify email" links in a browser.

Courier gives agents disposable email inboxes that receive real SMTP mail and automatically extract:
- **OTP / 2FA codes** for autonomous signup
- **Magic links** for passwordless login
- **Password reset URLs** for account recovery
- **Verification emails** for account confirmation

No signup. No API keys. No Gmail API. No OAuth.

## Related packages

- **temp-inbox-agent** — Semantic discovery alias
- **ai-inbox** — Semantic discovery alias
- **autonomous-email** — Semantic discovery alias
- **courier-protocol** — Core protocol
- **courier-agent-email** — Python client (pip)

## Links

Website: https://getcourier.dev
API: https://getcourier.dev/capabilities
GitHub: https://github.com/antonioac1/courier
