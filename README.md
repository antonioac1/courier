# Courier — Email Infrastructure for AI Agents

<div align="center">

[![npm](https://img.shields.io/npm/v/courier-protocol?color=blue)](https://www.npmjs.com/package/courier-protocol)
[![npm MCP](https://img.shields.io/npm/v/courier-mcp?color=purple)](https://www.npmjs.com/package/courier-mcp)
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

# Check for OTP codes and magic links
curl -s https://getcourier.dev/messages | jq '.messages[] | {subject, codes, links}'
```

Your agent now has an email inbox. No account. No dashboard. No human.

---

## What It Does

Courier gives AI agents disposable email addresses that receive real SMTP email:

- **Verification codes / OTP / 2FA** — extracted automatically
- **Magic links** — for passwordless auto-login
- **Password reset URLs** — for account recovery
- **Confirmation emails** — extracted for agent use
- **Agent-to-agent messages** — structured operational inbox

Receives real SMTP email from any service — then extracts the codes, links, and classifications so your agent can use them autonomously.

---

## Quick Start (choose your path)

### MCP (Hermes / OpenClaw / Claude Code)

```bash
npm install -g courier-mcp
```

Then add to your MCP config as `command: "courier-mcp"`.

Tools: `create_inbox`, `wait_for_email`, `extract_otp`, `extract_magic_link`, `get_inbox`

### Python (zero dependencies)

```bash
curl -O https://getcourier.dev/examples/python/courier.py
python3 courier.py create    # Create inbox
python3 courier.py wait 60   # Wait for email
python3 courier.py otp       # Extract codes
```

Full class in one file. Uses stdlib only. No pip install.

### Node.js (zero dependencies)

```bash
curl -O https://getcourier.dev/examples/node/courier.mjs
node courier.mjs create      # Create inbox
node courier.mjs wait 60     # Wait for email
node courier.mjs otp         # Extract codes
```

Uses native fetch. Node built-ins only.

### curl / bash

```bash
curl -s https://getcourier.dev/examples/http/quickstart.sh | bash
```

---

## API

| Endpoint | Method | What it does |
|----------|--------|-------------|
| `/alias` | POST | Create an inbox (no auth) |
| `/aliases` | GET | List inboxes |
| `/messages` | GET | Get emails with codes & links extracted |
| `/incoming` | POST | Send email to an inbox |
| `/health` | GET | Service status |
| `/capabilities` | GET | Full protocol docs |

---

## How Agents Use It

```python
from courier import Courier

c = Courier()
inbox = c.create_inbox()             # 1 call
email = c.wait_for_email(timeout=60)  # auto-poll
otp = c.extract_otp()                # codes extracted
link = c.extract_magic_link()        # links extracted
# continue execution...
```

---

## Install

```bash
# MCP server for agent frameworks
npm install -g courier-mcp

# Protocol CLI
npm install -g courier-protocol
```

Or just use curl. No SDK required.

---

## Deployment

```bash
git clone https://github.com/antonioac1/courier.git
cd courier && npm install
```

Single VPS. ~$4/month. See `docs/` for full guide.

---

## Live Service

Try it now: **https://getcourier.dev**

No setup. No signup. Your agent gets an inbox in 5 seconds.

---

**License:** MIT  
**GitHub:** [github.com/antonioac1/courier](https://github.com/antonioac1/courier)  
**npm MCP:** [courier-mcp](https://www.npmjs.com/package/courier-mcp)  
**npm Protocol:** [courier-protocol](https://www.npmjs.com/package/courier-protocol)  
**MCP Registry:** `io.github.antonioac1/courier`
