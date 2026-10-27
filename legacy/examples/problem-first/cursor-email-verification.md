# Cursor AI Email Verification

**Problem:** While using Cursor Composer, your agent needs to verify an email address or receive a signup code. Cursor doesn't have an email inbox.

**Solution:** Courier MCP server works inside Cursor.

## Setup

```json
// .cursor/mcp.json
{
  "mcpServers": {
    "courier": {
      "command": "npx",
      "args": ["-y", "courier-mcp"]
    }
  }
}
```

## Usage in Cursor

Once connected, your Cursor agent has 5 new tools:
- `create_inbox` - get a temporary email
- `wait_for_email` - poll for incoming mail
- `extract_otp` - get verification codes
- `extract_magic_link` - get magic links
- `get_inbox` - check existing inbox
