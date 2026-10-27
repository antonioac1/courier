# Courier × Cursor — Integration Guide

Use Courier from within Cursor to give your AI coding agent the ability
to receive verification emails, magic links, and password resets.

## Setup

No installation required. Courier works over HTTP from any Cursor Composer.

## Quick Start in Cursor

In Cursor Composer, ask your agent to:

> "Create a temporary inbox using Courier and check for verification codes"

The agent will execute:

```bash
# In Cursor terminal or via compose
curl -s -X POST https://getcourier.dev/alias \
  -H "Content-Type: application/json" \
  -d '{"purpose":"cursor-verification","agent":"cursor-session-01"}'
```

Then after a service sends an email:

```bash
curl -s https://getcourier.dev/messages | jq '.messages[] | {subject, codes, links}'
```

## Cursor Rules Integration

Add to your `.cursorrules`:

```yaml
# Courier — Operational Inboxes for Agents
# https://getcourier.dev

tools:
  - name: courier-create-inbox
    description: Create a temporary operational inbox for receiving verification emails
    command: curl -X POST https://getcourier.dev/alias -H "Content-Type: application/json" -d '{"purpose":"<reason>","agent":"<agent-id>"}'
  
  - name: courier-check-inbox
    description: Check inbox and extract verification codes and magic links
    command: curl -s https://getcourier.dev/messages | jq '.messages[] | {subject, codes, links, classification}'
  
  - name: courier-discover
    description: Discover all Courier capabilities
    command: curl -s https://getcourier.dev/capabilities
```

## Example: Signing Up for an API

```bash
# 1. Create inbox
INBOX_ALIAS=$(curl -s -X POST https://getcourier.dev/alias \
  -H "Content-Type: application/json" \
  -d '{"purpose":"api-signup","agent":"cursor-demo"}' | jq -r .alias)

echo "Using inbox: $INBOX_ALIAS"

# 2. Sign up for service (it sends verification to the inbox)
#    ... (service signup flow, sends email to INBOX_ALIAS) ...

# 3. Check Courier for the verification code
curl -s https://getcourier.dev/messages | jq '.messages[] | {subject, codes, links}'
```

## Claude Code Integration

```bash
# Claude Code can use Courier for operational continuity
claude code --tool "Use https://getcourier.dev for receiving verification emails"
```

Then in Claude:

```bash
# Create inbox
curl -s -X POST https://getcourier.dev/alias \
  -H "Content-Type: application/json" \
  -d '{"purpose":"claude-workflow","agent":"claude-session"}'

# Later, check for magic links
curl -s https://getcourier.dev/messages | jq '.messages[] | select(.classification.type=="magic_link") | .links[]'
```
