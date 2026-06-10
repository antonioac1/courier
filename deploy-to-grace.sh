#!/usr/bin/env bash
#
# deploy-to-grace.sh — Deploy website and examples to Grace VPS
# Run this from the repo root after SSH access to Grace is restored.
#
# Usage: bash deploy-to-grace.sh
#

set -e

GRACE="root@5.161.203.39"
WWW="/var/www/courier"
REPO="/root/courier-protocol"

echo "Deploying Courier website to Grace VPS..."

# Deploy website files
scp "$REPO/public/index.html" "$GRACE:$WWW/index.html"
scp "$REPO/llms.txt" "$GRACE:$WWW/llms.txt"
scp "$REPO/agent.json" "$GRACE:$WWW/agent.json"
scp "$REPO/install.sh" "$GRACE:$WWW/install.sh"

# Deploy examples
ssh "$GRACE" "mkdir -p $WWW/examples/{python,node,http}"
scp "$REPO/examples/python/courier.py" "$GRACE:$WWW/examples/python/courier.py"
scp "$REPO/examples/node/courier.mjs" "$GRACE:$WWW/examples/node/courier.mjs"
scp "$REPO/examples/http/quickstart.sh" "$GRACE:$WWW/examples/http/quickstart.sh"

# Set permissions
ssh "$GRACE" "chmod -R a+r $WWW && chmod a+x $WWW/install.sh $WWW/examples/http/quickstart.sh"

# Reload nginx
ssh "$GRACE" "nginx -t && systemctl reload nginx"

echo ""
echo "Deployed! Files at $WWW:"
ssh "$GRACE" "ls -la $WWW/ $WWW/examples/python/ $WWW/examples/node/ $WWW/examples/http/"

echo ""
echo "Verify: curl -s https://getcourier.dev/ | head -5"
