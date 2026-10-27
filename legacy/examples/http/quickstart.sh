#!/usr/bin/env bash
set -e

BASE=${COURIER_API:-https://getcourier.dev}

echo "=================================="
echo " Courier - Email for AI Agents"
echo " https://getcourier.dev"
echo "=================================="
echo ""

# Step 1: Create an inbox (no signup)
echo "1. Creating an inbox..."
INBOX=$(curl -s -X POST $BASE/alias \
  -H "Content-Type: application/json" \
  -d '{"purpose":"quickstart","agent":"demo-cli"}' | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('alias', {}).get('alias', d.get('alias', 'error')))
")
echo "   Inbox created: $INBOX"
echo "   Email: $INBOX@mail.getcourier.dev"
echo ""

# Step 2: Check for messages
echo "2. Checking messages..."
curl -s "$BASE/messages?limit=5" | python3 -m json.tool 2>/dev/null || echo "   No messages yet"
echo ""

# Step 3: Wait for email (polling)
echo "3. Waiting for email (30s timeout)..."
for i in $(seq 1 10); do
  MSGS=$(curl -s "$BASE/messages?limit=5" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(len(d.get('messages', [])))
")
  if [ "$MSGS" -gt 0 ] 2>/dev/null; then
    echo "   Email received!"
    curl -s "$BASE/messages?limit=5" | python3 -m json.tool
    break
  fi
  echo "   Waiting... ($((i * 3))s)"
  sleep 3
done
echo ""

# Step 4: Extract OTP codes
echo "4. Extracting OTP codes..."
curl -s "$BASE/messages?limit=50" | python3 -c "
import sys, json
d = json.load(sys.stdin)
found = False
for m in d.get('messages', []):
    if m.get('codes'):
        found = True
        print(f\"  Code: {m['codes']} (from: {m.get('subject', '?')})\")
if not found:
    print('  No codes found')
"
echo ""

# Step 5: Health check
echo "5. Service health..."
curl -s $BASE/health | python3 -m json.tool

echo ""
echo "Done! Your agent now has email."
echo "Full API: curl -s $BASE/capabilities | python3 -m json.tool"
