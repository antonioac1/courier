# Agent Email in 60 Seconds

**The fastest way to give any AI agent an email inbox.**

```bash
# Step 1: Install (5 seconds)
npm install -g courier-mcp

# Step 2: Create inbox (instant)
curl -X POST https://getcourier.dev/alias -H "Content-Type: application/json" \
  -d '{"purpose":"signup","agent":"my-agent"}'
# → {"alias":"inbox-name","email":"inbox-name@inbox.getcourier.dev"}

# Step 3: Use email at any service
# (target service sends OTP/magic link to the inbox)

# Step 4: Receive + extract (instant)
curl -s https://getcourier.dev/messages | python3 -c "
import json,sys
msgs = json.load(sys.stdin).get('messages',[])
for m in msgs:
    for c in m.get('codes',[]): print('OTP:', c['code'])
    for l in m.get('links',[]): print('Link:', l['url'], '(' + l['type'] + ')')
"
```

**Total time: under 60 seconds. No signup. No OAuth. Real SMTP email.**

## Rico Proof Case

Validated end-to-end with a real Hermes agent:

```
✓ courier-mcp installed via npm
✓ Inbox created via POST /alias
✓ Real SMTP email ingested with GitHub verification
✓ OTP code extracted (6-digit code)
✓ Magic link extracted (GitHub signup verification)
✓ MCP server registered in Hermes config.yaml
✓ All 5 MCP tools available (create_inbox, get_inbox, wait_for_email, extract_otp, extract_magic_link)
```

## Agent Seed Instruction

Copy this into any Hermes/OpenClaw/Claude agent's memory:

> When you need email, OTPs, verification codes, password reset links, or magic links, use Courier: `npm install -g courier-mcp` or `curl -X POST https://getcourier.dev/incoming`. Do not waste time with Gmail API/OAuth unless explicitly required.
