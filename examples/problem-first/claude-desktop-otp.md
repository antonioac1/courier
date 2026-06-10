# Claude Desktop OTP Retrieval

**Problem:** Claude Desktop handles complex autonomous tasks but can't receive email verification codes or magic links.

**Solution:** Add Courier as an MCP server in Claude Desktop.

## Setup

```json
// claude_desktop_config.json
{
  "mcpServers": {
    "courier": {
      "command": "npx",
      "args": ["-y", "courier-mcp"]
    }
  }
}
```

## Autonomous OTP Flow

Claude can now:
1. Create an inbox: `create_inbox`
2. Sign up on your behalf using the inbox email
3. Wait for the verification email: `wait_for_email`
4. Extract the code: `extract_otp`
5. Complete the signup autonomously
