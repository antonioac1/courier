# Temporary Inbox for OpenAI Agents

**Problem:** OpenAI Agents SDK agents can browse, code, and use tools, but can't receive email verification codes.

**Solution:** Use Courier via its Python client (zero dependencies).

```python
from courier_agent import CourierAgent
from openai import OpenAI

client = OpenAI()
agent = CourierAgent()

# Give your agent an inbox
inbox = agent.create_inbox()

# Use the inbox email in a signup flow
# openai_agent.signup(email=inbox["email"])

# Your agent retrieves the code
otp = agent.extract_otp()

# Continue execution with the code
```
