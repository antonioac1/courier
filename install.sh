#!/usr/bin/env bash
#
# Courier - 60-second Install Flow
# Complete autonomous setup for any AI agent.
#
# What this does:
#   1. Install courier-mcp (MCP server for agent tool integration)
#   OR download single-file clients (zero deps)
#   2. Create an inbox
#   3. Verify everything works
#
# Usage:
#   bash <(curl -s https://getcourier.dev/install.sh)
#

set -e

BASE="${COURIER_API:-https://getcourier.dev}"

echo ""
echo "============================================"
echo " Courier - Email for AI Agents"
echo " Install in under 60 seconds"
echo "============================================"
echo ""

MODE="${1:-auto}"

case "$MODE" in
  mcp)
    echo "Installing courier-mcp (MCP server)..."
    npm install -g courier-mcp 2>/dev/null || {
      echo "npm not available. Trying Python client..."
      MODE="python"
    }
    if command -v courier-mcp &>/dev/null; then
      echo "   Done: $(which courier-mcp)"
      echo ""
      echo "Add to Hermes config:"
      echo '  mcp_servers:'
      echo '    courier:'
      echo '      command: "courier-mcp"'
      echo ""
      echo "Or for Claude Code:"
      echo '  claude mcp add courier-mcp'
    fi
    ;;

  python)
    echo "Downloading Python client..."
    curl -s -o courier.py https://getcourier.dev/examples/python/courier.py
    chmod +x courier.py
    echo "   courier.py saved"
    echo "   Usage: python3 courier.py create"
    ;;

  node)
    echo "Downloading Node.js client..."
    curl -s -o courier.mjs https://getcourier.dev/examples/node/courier.mjs
    chmod +x courier.mjs
    echo "   courier.mjs saved"
    echo "   Usage: node courier.mjs create"
    ;;

  mcp-hermes)
    echo "Installing courier-mcp for Hermes/OpenClaw..."
    npm install -g courier-mcp 2>/dev/null || true
    COURIER_MCP=$(which courier-mcp 2>/dev/null || echo "courier-mcp")
    # Add to Hermes config if it exists
    if [ -f ~/.hermes/config.yaml ]; then
      grep -q "courier-mcp" ~/.hermes/config.yaml 2>/dev/null || {
        echo "" >> ~/.hermes/config.yaml
        echo "mcp_servers:" >> ~/.hermes/config.yaml
        echo "  courier:" >> ~/.hermes/config.yaml
        echo "    command: \"$COURIER_MCP\"" >> ~/.hermes/config.yaml
        echo "   Added to ~/.hermes/config.yaml"
      }
    else
      echo "Add to your MCP config:"
      echo '  "mcp_servers": {'
      echo '    "courier": {'
      echo '      "command": "'$COURIER_MCP'"'
      echo '    }'
      echo '  }'
    fi
    ;;
esac

# Create an inbox
echo ""
echo "Creating an inbox..."
INBOX=$(curl -s -X POST $BASE/alias \
  -H "Content-Type: application/json" \
  -d '{"purpose":"install","agent":"auto"}' | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('alias', {}).get('alias', d.get('alias', '?')))
")
echo "   Inbox: $INBOX"
echo "   Email: $INBOX@mail.getcourier.dev"
echo ""

# Verify
echo "Verifying..."
HEALTH=$(curl -s $BASE/health)
echo "   Service: $(echo $HEALTH | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")"
echo ""

echo "============================================"
echo " Courier is ready"
echo ""
echo " Inbox: $INBOX@mail.getcourier.dev"
echo " Create more: POST $BASE/alias"
echo " Check mail: GET  $BASE/messages"
echo ""
echo " MCP: npm install -g courier-mcp"
echo " Python: curl -O https://getcourier.dev/examples/python/courier.py"
echo " Node: curl -O https://getcourier.dev/examples/node/courier.mjs"
echo "============================================"
echo ""
echo "Next: Send an email to $INBOX@mail.getcourier.dev"
echo "Then: curl -s $BASE/messages | python3 -m json.tool"
