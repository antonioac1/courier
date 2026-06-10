# ai-inbox

**AI agent email inboxes.** Receive OTP codes, magic links, and verification emails.
No signup. No Gmail API. No OAuth.

## What this is

A discovery alias for **Courier** — agent-native email infrastructure.
Courier is the email layer agents can actually use.

```bash
# Quick start
npm install -g courier-mcp
curl -X POST https://getcourier.dev/alias -H "Content-Type: application/json" -d '{"purpose":"test"}'
curl -s https://getcourier.dev/messages | jq '.messages[] | {subject, codes, links}'
```

Related: **courier-mcp**, **temp-inbox-agent**, **autonomous-email**, **courier-protocol**
