# ai-inbox

Email inboxes for AI agents. Receive OTP codes, magic links, and verification emails. No signup.

**This is an alias package.** The underlying project is Courier.

## Quick Start

```bash
# MCP (any agent framework)
npm install -g courier-mcp

# Then in Python or curl:
curl -X POST https://getcourier.dev/alias -H "Content-Type: application/json" -d '{"purpose":"test"}'
curl -s https://getcourier.dev/messages | jq '.messages[] | {subject, codes, links}'
```
