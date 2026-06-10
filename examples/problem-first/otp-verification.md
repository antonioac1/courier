# How an AI Agent Handles OTP Verification

**Problem:** Your agent signs up for a service. The service sends a 6-digit verification code to an email address. Your agent has no email inbox.

**Solution:** Courier provides a temporary email inbox that receives the code and makes it available via API.

## The Flow

1. Agent creates a Courier inbox (5 seconds)
2. Agent uses the inbox email for signup
3. Service sends OTP to the inbox
4. Agent retrieves the code via API
5. Agent completes signup

## Code

```python
from courier_agent import CourierAgent

# Step 1: Create inbox
agent = CourierAgent()
inbox = agent.create_inbox()

# Step 2: Use inbox.email for signup
# service.signup(email=inbox["email"], ...)

# Step 3+4: Get the OTP code
otp_codes = agent.extract_otp()
# ["583920"]

# Step 5: Complete signup
# service.verify(code=otp_codes[0], ...)
```

## MCP (any agent framework)

```bash
npm install -g courier-mcp
# Then use create_inbox, wait_for_email, extract_otp tools
```
