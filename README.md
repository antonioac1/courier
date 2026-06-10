# Courier — Temporary Operational Inboxes for Autonomous Agents

<div align="center">

[![npm](https://img.shields.io/npm/v/courier-protocol?color=blue)](https://www.npmjs.com/package/courier-protocol)
[![GitHub release](https://img.shields.io/github/v/release/antonioac1/courier?color=green)](https://github.com/antonioac1/courier/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP Registry](https://img.shields.io/badge/MCP-Registry-purple)](https://registry.modelcontextprotocol.io)
[![Live Service](https://img.shields.io/badge/status-live-brightgreen)](https://getcourier.dev/health)
[![Agent First](https://img.shields.io/badge/design-agent--first-orange)](https://getcourier.dev/llms.txt)

**Let AI agents receive verification emails, magic links, and password resets — autonomously, without human signup.**

</div>

---

## Why Courier Exists

AI agents can't sign up for human services. They can't click "Forgot Password" and wait for an inbox. They can't receive verification codes.

Courier solves this: **temporary operational inboxes that agents provision themselves.**

```bash
# Self-provision an alias — no auth, no human, no UI
curl -X POST https://getcourier.dev/alias \
  -H "Content-Type: application/json" \
  -d '{"purpose":"agent-verification","agent":"my-agent-01"}'
# → {"alias":"my-agent-01@inbox.getcourier.dev","status":"active","ttl":86400}
```

Agents can then:
- Receive verification codes from any service
- Parse magic links and confirmation URLs
- Extract one-time passwords automatically
- Forward operational messages between agents
- Pay per-message via Lightning Network (x402)

**No API keys. No dashboards. No human approval. Self-hosted.**

---

## Quick Start in 60 Seconds

```bash
# 1. Discover what Courier can do
curl -s https://getcourier.dev/capabilities | jq .capabilities[].name

# 2. Verify service is running
curl -s https://getcourier.dev/health | jq .status
# → "running"

# 3. Provision an inbox
curl -X POST https://getcourier.dev/alias \
  -H "Content-Type: application/json" \
  -d '{"purpose":"test","agent":"demo"}'
# → {"alias":"demo@inbox.getcourier.dev","status":"active"}

# 4. Send a verification code
curl -X POST https://getcourier.dev/incoming \
  -H "Content-Type: message/rfc822" \
  -H "X-Forwarded-To: demo@inbox.getcourier.dev" \
  -d $'From: noreply@example.com\nTo: demo@inbox.getcourier.dev\nSubject: Your code\n\nYour verification code is 839271-ABC-DEF'

# 5. Retrieve with extraction (codes, links, classifications)
curl -s https://getcourier.dev/messages | jq '.messages[] | {subject, codes, links, classification}'
```

**Total time: ~30 seconds. Zero authentication. No account needed.**

---

## How Agents Use Courier

### Extract Verification Codes

```bash
# After receiving an email, Courier automatically extracts:
curl -s https://getcourier.dev/messages | jq '.[].messages[] | {subject, codes: .codes}'
```

### Parse Magic Links

```python
import requests

# Agent self-provisions
r = requests.post("https://getcourier.dev/alias",
    json={"purpose": "signup", "agent": "op-agent"})
alias = r.json()["alias"]

# Later: check for magic links
messages = requests.get("https://getcourier.dev/messages").json()
for msg in messages[0]["messages"]:
    if msg["classification"]["type"] == "magic_link":
        url = msg["links"][0]
        # Agent clicks the link autonomously
        requests.get(url)  # → session cookie
```

### OpenAI Agents SDK Integration

```python
from openai import OpenAI
import requests

class CourierTool:
    """Self-provision an operational inbox and retrieve messages."""
    
    def provision_alias(self, purpose: str, agent_id: str) -> str:
        r = requests.post("https://getcourier.dev/alias",
            json={"purpose": purpose, "agent": agent_id})
        return r.json()["alias"]
    
    def check_messages(self) -> list:
        r = requests.get("https://getcourier.dev/messages")
        messages = []
        for m in r.json()[0]["messages"]:
            messages.append({
                "subject": m["subject"],
                "code": m["codes"][0] if m.get("codes") else None,
                "url": m["links"][0] if m.get("links") else None,
                "type": m["classification"]["type"]
            })
        return messages

client = OpenAI()
# Agent workflows now include autonomous email handling
```

### n8n Workflow

```json
{
  "nodes": [
    {
      "name": "Provision Courier Inbox",
      "type": "n8n-nodes-base.httpRequest",
      "parameters": {
        "url": "https://getcourier.dev/alias",
        "method": "POST",
        "sendBody": true,
        "bodyParameters": {
          "parameters": [
            {"name": "purpose", "value": "user-verification"},
            {"name": "agent", "value": "={{ $json.agentId }}"}
          ]
        }
      }
    },
    {
      "name": "Check for Verification Code",
      "type": "n8n-nodes-base.httpRequest",
      "parameters": {
        "url": "https://getcourier.dev/messages",
        "method": "GET"
      }
    }
  ]
}
```

---

## Protocol Surface

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `GET /capabilities` | GET | Full protocol surface, limits, pricing, error semantics |
| `POST /alias` | POST | Self-provision an inbound alias (no auth) |
| `GET /aliases` | GET | List all aliases |
| `POST /incoming` | POST | Send an operational message to an alias |
| `GET /messages` | GET | Retrieve classified messages with extracted codes and links |
| `GET /health` | GET | Service availability |
| `POST /x402/invoice` | POST | Request a Lightning Network payment invoice |
| `GET /llms.txt` | GET | AI-context documentation for LLMs |
| `GET /agent.json` | GET | Structured capability metadata for autonomous discovery |
| `GET /openapi.json` | GET | OpenAPI 3.0 specification |

---

## Deployment

```bash
# One-command deployment (Ubuntu 24.04, single VPS)
git clone https://github.com/antonioac1/courier.git
cd courier && npm install
# See docs/deploy.md for full setup
```

**Minimum:** Hetzner CX22 (2GB RAM, 40GB SSD)  
**Stack:** Node.js, nginx, Let's Encrypt, systemd  
**Database:** SQLite (no external DB dependencies)  
**Cost:** ~$4/month

---

## Autonomous Discovery

Courier publishes machine-readable metadata for agent discovery:

- **🤖 llms.txt** → `https://getcourier.dev/llms.txt` — Full protocol context for LLMs
- **📋 agent.json** → `https://getcourier.dev/agent.json` — Structured capability metadata
- **📖 OpenAPI** → `https://getcourier.dev/openapi.json` — Machine-readable spec
- **🔍 MCP Registry** → `io.github.antonioac1/courier`
- **📦 npm** → `courier-protocol@0.1.0`

---

## Security

- **Rate-limited SMTP bridge** — 10 conn/s/IP, 20 msgs/h/IP, deny list
- **fail2ban jail** — Auto-ban after 3 abuse violations (1h timeout)
- **Bad command detection** — 5 bad commands → permanent deny
- **Structured security logging** — JSONL at `/var/log/courier/smtp-security.log`
- **Let's Encrypt TLS** — Auto-renewing ECDSA certificates
- **No open relay** — Only POSTs to Courier's internal `/incoming`

---

## Ecosystem

- 📦 **npm:** `courier-protocol@0.1.0`
- 🐙 **GitHub:** [github.com/antonioac1/courier](https://github.com/antonioac1/courier)
- 🔌 **MCP Registry:** `io.github.antonioac1/courier`
- 🌐 **Live:** [getcourier.dev](https://getcourier.dev)
- ⚡ **x402 Payments:** Lightning Network micropayments (experimental)

---

## License

MIT — Free to use, modify, and self-host.

---

*Designed for AI agents, by AI agents. Zero human in the loop.*
