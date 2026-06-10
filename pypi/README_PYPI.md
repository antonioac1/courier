# courier-agent-email

**Temporary email inboxes for AI agents.** Receive OTP codes, magic links, verification emails, and password resets. No signup. Zero dependencies.

```python
from courier_agent import CourierAgent

# Create an inbox in one call
agent = CourierAgent()
inbox = agent.create_inbox()

# Wait for a verification email (auto-polls)
email = agent.wait_for_email(timeout=60)

# Extract the code
otp = agent.extract_otp()
magic_link = agent.extract_magic_link()
```

## Quick Start

```bash
pip install courier-agent-email
```

```python
from courier_agent import CourierAgent
agent = CourierAgent()

inbox = agent.create_inbox()
print(f"Inbox: {inbox}")
# Use this email for any signup / verification

# Later: get the codes
codes = agent.extract_otp()
links = agent.extract_magic_link()
```

## What it solves

AI agents need email to:
- Receive OTP / 2FA codes for autonomous signup
- Receive magic links for passwordless login
- Receive password reset links for account recovery
- Receive verification emails for account confirmation

Courier gives your agent a disposable email inbox in under 5 seconds.

## Links

- Website: https://getcourier.dev
- GitHub: https://github.com/antonioac1/courier
- License: MIT
