# x402 — HTTP 402 Payment Required Protocol for Lightning Network

## Overview

x402 is a payment protocol that uses HTTP status code `402 Payment Required` to request Lightning Network micropayments before granting access to paid features. Courier uses x402 for tier upgrades — an agent pays, the server verifies, and the agent's quota increases for the billing period.

The protocol is named after the HTTP status code (402) and the Lightning Network's invoice format (BOLT 11). It is designed for machine consumption: agents make decisions, pay invoices, and retry automatically.

---

## Protocol Flow

```
Agent                          Courier Server
  │                                  │
  │  POST /incoming                  │
  │  (free tier quota exhausted)     │
  │─────────────────────────────────>│
  │                                  │
  │  HTTP 402 Payment Required       │
  │  { error, code, invoice }        │
  │<─────────────────────────────────│
  │                                  │
  │  (Agent pays invoice via LN)     │
  │                                  │
  │  POST /incoming                  │
  │  X-402-Payment: <payment_hash>   │
  │─────────────────────────────────>│
  │                                  │
  │  HTTP 200 OK                     │
  │  (message ingested)              │
  │<─────────────────────────────────│
```

## Response Format (HTTP 402)

When a request hits a paid-tier requirement, the server responds:

```
HTTP/1.1 402 Payment Required
Content-Type: application/json
Retry-After: 60

{
  "error": true,
  "code": "PAYMENT_REQUIRED",
  "message": "Free tier quota exceeded; payment required",
  "retryable": true,
  "invoice": {
    "id": "inv_abc12345",
    "payment_hash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "amount_sats": 5000,
    "tier": "hobby",
    "description": "Courier Hobby — 100 aliases, 10K ingests/mo",
    "expires_at": "2025-06-09T12:10:00Z",
    "payment_request": "lnbc50n1p..."
  }
}
```

### Invoice Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Server-side invoice identifier |
| `payment_hash` | string | SHA-256 hash of payment preimage (64 hex chars) |
| `amount_sats` | integer | Amount in satoshis |
| `tier` | string | Target tier name: `hobby`, `agent`, `autonomous` |
| `description` | string | Human-readable tier description |
| `expires_at` | string (ISO 8601) | Invoice expiry timestamp |
| `payment_request` | string | BOLT 11 invoice string (lnbc...) |

## Pricing Tiers

| Tier | Cost (sats/mo) | Aliases | Ingests/mo | Use Case |
|------|---------------|---------|------------|----------|
| Free | 0 | 10 | 500 | Development, evaluation |
| Hobby | 5,000 | 100 | 10,000 | Single agent production |
| Agent | 25,000 | 1,000 | 100,000 | Multi-agent operations |
| Autonomous | 100,000 | Unlimited | Unlimited | Unrestricted operations |

## How an Agent Pays

1. **Detect payment required:** Check error body for `"code": "PAYMENT_REQUIRED"` and the `invoice` field.
2. **Parse invoice:** Extract `payment_request` (BOLT 11 string) and `amount_sats`.
3. **Pay via Lightning wallet:**
   - If the agent has a Lightning node, pay `payment_request` via the Lightning API.
   - If the agent uses a custodial wallet, send the invoice string to the wallet's payment endpoint.
4. **Capture `payment_hash`:** The SHA-256 hash used in the invoice — this proves payment.
5. **Re-send request with payment header:**

   ```
   POST /incoming
   X-402-Payment: <payment_hash>
   X-Forwarded-To: my-agent@inbox.getcourier.dev
   Content-Type: text/plain
   ```

6. **If invoice expired** (`expires_at` passed), request a new one via `POST /x402/invoice`.

### Agent-Side Pseudocode

```python
def request_with_payment(path, body, wallet):
    resp = http_request(path, body)
    if resp.status == 200:
        return resp.json()

    if resp.status != 402:
        raise UnexpectedStatus(resp.status)

    invoice = resp.json().get('invoice')
    if not invoice:
        raise InvalidInvoice()

    # Pay via Lightning wallet
    payment_result = wallet.pay(invoice['payment_request'])
    if not payment_result.success:
        raise PaymentFailed(payment_result.error)

    # Re-send with payment proof
    resp = http_request(
        path, body,
        headers={'X-402-Payment': invoice['payment_hash']}
    )
    return resp.json()
```

## How the Server Verifies Payment

1. **Receive request** with `X-402-Payment` header containing `payment_hash`.
2. **Look up invoice** by `payment_hash` or invoice `id`.
3. **Check payment status:**
   - If already marked as paid in server database: accept immediately.
   - If unpaid: query the Lightning node's invoice status via the LND/CLN API.
   - Check that `settled` is `true` and `amount` matches.
4. **On success:** Process the original request, associate the paid tier with the source IP or agent identifier.
5. **On failure:** Return `402 Payment Required` again with the original invoice (or a new one if expired).

### Invoice State Machine

```
CREATED → UNPAID → (payment received) → PAID → (tier active for billing period)
                       ↓ (expired)
                    EXPIRED → (agent requests new invoice) → CREATED
```

## Requesting Invoices

Agents can proactively request an invoice before hitting quota limits:

```
POST /x402/invoice
Content-Type: application/json

{
  "tier": "hobby"
}
```

Optional request body fields:

| Field | Type | Description |
|-------|------|-------------|
| `tier` | string | Desired tier: `hobby`, `agent`, `autonomous` |

Response: Same format as the invoice object within a 402 response (HTTP 200 with invoice data).

## Security Considerations

- **Payment hash uniqueness:** Each invoice has a unique `payment_hash`. Replay attacks are prevented because a settled invoice cannot be reused.
- **Invoice expiry:** Invoices expire in 10 minutes by default. Agents must pay before expiry.
- **Tier binding:** Payments are bound to the source IP and `X-Forwarded-From` identifier, not to an API key (there are none).
- **Payment verification:** The server verifies payment with the Lightning node before granting access. No blind trust.
- **HTTPS required:** All payment flows go over TLS. Never send payment hashes over plain HTTP.

## Implementation Status

- **Status:** Experimental
- **Endpoint:** `POST /x402/invoice`
- **Header:** `X-402-Payment`
- **Lightning backend:** LND or CLN (configurable)

## References

- HTTP 402: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/402
- BOLT 11: https://github.com/lightning/bolts/blob/master/11-payment-encoding.md
- Lightning Network: https://lightning.network
