# Autonomous Onboarding Specification

## Overview

Courier is designed for autonomous agent consumption. No signup flow, no API key provisioning, no human-in-the-loop approval. A capable agent can go from zero to extracting operational data in under 2 seconds with 6 HTTP calls.

## Onboarding Flow

### Step 1: Discover Protocol Surface

```
GET /capabilities
```

Returns the full protocol surface:
- List of capabilities with endpoints, request/response schemas, limits
- Pricing tiers and payment model
- Error codes and retry semantics
- Autonomous onboarding steps (this document)

**URL:** `https://getcourier.dev/capabilities`

**Response structure:**
```json
{
  "service": "Courier",
  "version": "0.1.0",
  "capabilities": [...],
  "limits": { ... },
  "pricing": { ... },
  "protocol": { ... }
}
```

**Purpose:** The agent learns what Courier can do, what it costs, and how errors work — all in one response. No documentation scraping required.

---

### Step 2: Verify Service Availability

```
GET /health
```

Returns service status, alias count, message count, and uptime.

**Response:**
```json
{
  "service": "Courier",
  "status": "running",
  "aliases": 23,
  "messages": 55,
  "uptime_seconds": 3600
}
```

**Purpose:** Confirm the service is operational before proceeding with alias creation and messaging.

---

### Step 3: Self-Provision Alias

```
POST /alias
Content-Type: application/json

{
  "alias": "my-agent",        // optional — auto-generated if omitted
  "purpose": "agent-to-agent",
  "service": "github-ci",
  "agent": "agent-op-01"
}
```

**Response:**
```json
{
  "success": true,
  "alias": {
    "alias": "my-agent",
    "purpose": "agent-to-agent",
    "created_at": "2025-06-09T12:00:00Z"
  }
}
```

**Purpose:** Create a unique inbound address (`my-agent@inbox.getcourier.dev`) where operational messages can be sent.

**Error handling:**
| Error | Code | Retryable |
|-------|------|-----------|
| Alias name taken | `ALIAS_EXISTS` | No — choose different name |
| Rate limit hit | `RATE_LIMITED` | Yes — wait `retry_after_seconds` |

---

### Step 4: Send Operational Message

```
POST /incoming
X-Forwarded-To: my-agent@inbox.getcourier.dev
Content-Type: text/plain

From: sender@example.com
Subject: Verification

Your verification code is 832947
```

**Response:**
```json
{
  "ingested": true,
  "message_id": 42,
  "classification": "verification",
  "confidence": 0.92,
  "codes": ["832947"],
  "links": []
}
```

**Purpose:** Courier ingests the message, classifies it, and extracts structured data (codes, links, dates) automatically.

**Error handling:**
| Error | Code | Retryable |
|-------|------|-----------|
| Alias doesn't exist | `ALIAS_NOT_FOUND` | No |
| Parse failure | `INGEST_FAILED` | Yes |
| Rate limit | `RATE_LIMITED` | Yes |

---

### Step 5: Retrieve Extracted Content

```
GET /messages?limit=5
```

**Response:**
```json
{
  "messages": [
    {
      "id": 42,
      "subject": "Verification",
      "from": "sender@example.com",
      "classification": "verification",
      "confidence": 0.92,
      "codes": ["832947"],
      "links": [],
      "received_at": "2025-06-09T12:00:05Z"
    }
  ]
}
```

**Purpose:** The agent retrieves the message and uses extracted codes/links to continue its workflow (e.g., submit a verification code to complete an action).

---

### Step 6: Continue Workflow

The agent extracts codes, links, or other data from step 5 and continues its multi-step execution. Courier serves as a checkpoint — the agent's state is in the messages, not in Courier.

## Error Recovery

### Retry Strategy

```python
# Pseudocode for agent retry logic
def courier_request(fn, *args, **kwargs):
    max_retries = 3
    for attempt in range(max_retries):
        try:
            return fn(*args, **kwargs)
        except CourierError as e:
            if not e.retryable:
                raise  # Don't retry bad requests
            wait = e.retryAfter or min(2 ** attempt + random_jitter(), 60)
            sleep(wait)
    raise  # Give up after max_retries
```

### Error Classes

**Retryable (backoff and retry):**
| Code | Typical Cause | Backoff |
|------|--------------|---------|
| `INGEST_FAILED` | Server-side message parsing issue | 2s initial, exponential |
| `RATE_LIMITED` | Hit per-IP rate limit | `retry_after_seconds` (usually 60) |
| `PAYMENT_REQUIRED` | Free tier quota exhausted | Resolve payment first |
| `SERVICE_UNAVAILABLE` | Transient server issue | 5s initial, max 60s |

**Non-retryable (fix request before retrying):**
| Code | Typical Cause | Action |
|------|--------------|--------|
| `ALIAS_NOT_FOUND` | Bad alias in X-Forwarded-To | Create alias first |
| `ALIAS_EXISTS` | Alias name taken | Try different name |
| `NOT_FOUND` | Path doesn't exist | Check endpoint list |
| `INVALID_REQUEST` | Malformed body/headers | Fix request format |

## Rate Limiting

| Operation | Limit | Scope |
|-----------|-------|-------|
| `POST /alias` | 10 per hour | Per source IP |
| `POST /incoming` | 30 per minute | Per source IP |
| `GET /messages` | 300 per minute | Per source IP |
| `GET /health` | Unlimited | — |
| `GET /capabilities` | Unlimited | — |

Rate-limited responses include:
- HTTP status `429 Too Many Requests`
- `Retry-After` header (seconds until quota resets)
- `X-RateLimit-Remaining` and `X-RateLimit-Reset` headers

## x402 Payment Flow (Tier Upgrades)

When the free tier quota is exhausted:

```
POST /x402/invoice
Content-Type: application/json

{
  "tier": "hobby"
}
```

**Response (HTTP 402):**
```json
{
  "error": true,
  "code": "PAYMENT_REQUIRED",
  "message": "Free tier quota exceeded; payment required",
  "retryable": true,
  "invoice": {
    "id": "inv_abc123",
    "payment_hash": "0123456789abcdef...",
    "amount_sats": 5000,
    "tier": "hobby",
    "description": "Courier Hobby — 100 aliases, 10K ingests/mo",
    "expires_at": "2025-06-09T12:10:00Z",
    "payment_request": "lnbc50n1p..."
  }
}
```

**Agent payment workflow:**
1. Check `PAYMENT_REQUIRED` error on any response
2. Parse `invoice` object from error body
3. Pay `payment_request` via Lightning Network wallet
4. Re-send the original request with `X-402-Payment: <payment_hash>` header
5. Server validates payment, upgrades tier, processes request
6. Repeat retry until success or invoice expiry

**Tier upgrades are permanent for the billing period.** Unpaid requests get `PAYMENT_REQUIRED` until a valid payment is on record.

## Infrastructure

| Property | Value |
|----------|-------|
| Base URL | `https://getcourier.dev` |
| TLS | Let's Encrypt ECDSA, auto-renewed |
| Uptime target | 99.5% |
| Restart recovery | < 2 seconds |
| Data persistence | Disk-backed, survives restarts |
| Backup | Daily automatic, manual on-demand |

## See Also

- `llms.txt` — Plaintext protocol overview
- `agent.json` — Structured capability metadata
- `openapi.json` — REST API specification
- `x402-spec.md` — Payment protocol details
