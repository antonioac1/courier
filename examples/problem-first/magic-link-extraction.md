# How Autonomous Agents Handle Magic Links

**Problem:** Your agent needs to log into a service that uses passwordless email login (magic links). The link is sent to an email address your agent doesn't have.

**Solution:** Courier receives the magic link email and extracts the URL so your agent can use it.

```python
from courier_agent import CourierAgent

# Create an inbox
agent = CourierAgent()
inbox = agent.create_inbox()

# Request magic link from service
# service.request_login(email=inbox["email"])

# Wait and extract
agent.wait_for_email(timeout=30)
link = agent.extract_magic_link()
# ["https://service.com/login?token=abc123..."]

# Navigate to authenticated page
# agent.browser.navigate(link[0])
```
