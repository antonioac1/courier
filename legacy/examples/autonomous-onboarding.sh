#!/bin/bash
# Autonomous Courier onboarding — 6-step curl flow
# No API key required. No human approval. Zero signup.
# Requirements: curl, jq

set -e

BASE="https://getcourier.dev"

echo "=== COURIER AUTONOMOUS ONBOARDING ==="

echo ""
echo "Step 1: Discover protocol surface"
echo "---"
curl -s $BASE/capabilities | jq .capabilities[].name

echo ""
echo "Step 2: Verify service availability"
echo "---"
curl -s $BASE/health | jq .status

echo ""
echo "Step 3: Self-provision alias"
echo "---"
ALIAS_RESP=$(curl -s -X POST $BASE/alias \
  -H "Content-Type: application/json" \
  -d '{"purpose":"agent-to-agent","agent":"my-agent"}')
echo "$ALIAS_RESP"
ALIAS=$(echo "$ALIAS_RESP" | jq -r .alias.alias)

if [ "$ALIAS" = "null" ] || [ -z "$ALIAS" ]; then
  echo "ERROR: Failed to create alias"
  exit 1
fi
echo "Alias created: $ALIAS"

echo ""
echo "Step 4: Send operational message"
echo "---"
curl -s -X POST $BASE/incoming \
  -H "X-Forwarded-To: $ALIAS@inbox.getcourier.dev" \
  -d "From: sender@example.com\nSubject: Verification\n\nYour code is 832947"

echo ""
echo ""
echo "Step 5: Retrieve extracted content"
echo "---"
curl -s "$BASE/messages?limit=5" | jq .messages[0].codes

echo ""
echo "Step 6: Continue workflow"
echo "---"
echo "Workflow checkpoint — autonomous integration complete."
echo ""
echo "=== ONBOARDING COMPLETE ==="
