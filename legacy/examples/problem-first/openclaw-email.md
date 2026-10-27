# OpenClaw Email Integration

**Problem:** OpenClaw agents automate browser tasks but need email for verification steps.

**Solution:** Courier MCP server integrated into OpenClaw.

```bash
npm install -g courier-mcp
# Add courier-mcp to your MCP config
```

OpenClaw can then create inboxes, wait for verification emails, and extract codes during browser automation tasks.
