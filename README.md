# Courier — Email Infrastructure for AI Agents

<div align="center">

[![npm](https://img.shields.io/npm/v/courier-protocol?color=blue)](https://www.npmjs.com/package/courier-protocol)
[![GitHub release](https://img.shields.io/github/v/release/antonioac1/courier?color=green)](https://github.com/antonioac1/courier/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Live Service](https://img.shields.io/badge/status-live-brightgreen)](https://getcourier.dev/health)
[![MCP Registry](https://img.shields.io/badge/MCP-Registry-purple)](https://registry.modelcontextprotocol.io)

**Give your AI agent an email inbox in under 5 seconds.**

No signup. No API keys. No human approval.

</div>

---

## Quick Start — 5 Seconds

```bash
# Give your agent an inbox
curl -X POST https://getcourier.dev/alias \
  -H "Content-Type: application/json" \
  -d '{"purpose":"otp","agent":"my-agent"}'

# → {"alias":"my-agent@inbox.getcourier.dev","status":"active"}

# Check for OTP codes
curl -s https://getcourier.dev/messages | jq '.messages[] | {subject, codes, links}'
```

Your agent now has an email inbox. No account. No dashboard. No human.

---

## What It Does

Courier gives AI agents disposable email addresses that receive:

- **🔢 One-time passwords / verification codes**
- **🔗 Magic links**
- **🔐 Password reset URLs**
- **📨 Confirmation emails**
- **🤖 Agent-to-agent messages**

Receives real SMTP email from any service — then extracts the codes, links, and classifications so your agent can use them autonomously.

---

## Why Agents Need It

AI agents can't click "Forgot Password" and wait for an inbox. They can't receive verification codes during signup. Courier solves this:

```
Service sends email → SMTP port 25 → Courier extracts codes/links → Agent retrieves via API
```

Your agent provisions an inbox in one API call, then receives and parses emails automatically.

---

## 5-Minute Integrations

### OpenAI Agents SDK

```python
import requests

# Give your agent an inbox
r = requests.post("https://getcourier.dev/alias",
    json={"purpose": "verification", "agent": "my-agent"})
inbox = r.json()["alias"]

# Later: check for OTP codes
r = requests.get("https://getcourier.dev/messages")
for msg in r.json()[0]["messages"]:
    if msg.get("codes"):
        code = msg["codes"][0]
        print(f"Found verification code: {code}")
        # Your agent uses code to complete signup
```

### Claude Code

```bash
# From Claude Code or any shell
alias=$(curl -s -X POST https://getcourier.dev/alias \
  -H "Content-Type: application/json" \
  -d '{"purpose":"claude-workflow","agent":"claude-session"}' | jq -r .alias)

# Use alias for service signup, then:
curl -s https://getcourier.dev/messages | jq '.messages[] | {subject, codes, links}'
```

### Cursor

```bash
# In Cursor Composer or terminal:
curl -s https://getcourier.dev/messages | jq '.messages[] | select(.classification.type=="magic_link") | .links[]'
```

### Python

```python
# pip install requests
from courier_agent import CourierAgent
agent = CourierAgent("demo")
inbox = agent.provision_inbox()
codes = agent.check_for_codes()
```

See `examples/` for full working code.

---

## API

| Endpoint | What it does |
|----------|-------------|
| `POST /alias` | Create an inbox (no auth) |
| `GET /messages` | Get emails with codes & links extracted |
| `POST /incoming` | Send an email to an inbox |
| `GET /health` | Is it running? |
| `GET /capabilities` | Full protocol docs |

---

## Install

```bash
npm install courier-protocol
```

Or just use curl. No SDK required.

---

## Deployment

```bash
git clone https://github.com/antonioac1/courier.git
cd courier && npm install
# See docs for full setup — single VPS, ~$4/month
```

---

## Live Service

Try it now: **https://getcourier.dev**

No setup. No signup. Your agent gets an inbox in 5 seconds.

---

**License:** MIT  
**GitHub:** [github.com/antonioac1/courier](https://github.com/antonioac1/courier)  
**npm:** [courier-protocol](https://www.npmjs.com/package/courier-protocol)  
**MCP Registry:** `io.github.antonioac1/courier`
