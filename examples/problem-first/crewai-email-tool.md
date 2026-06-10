# CrewAI Email Tool for Autonomous Verification

**Problem:** CrewAI agents need email during multi-agent workflows (signing up for services, receiving confirmations).

**Solution:** Use Courier as a CrewAI tool.

```python
from crewai import Agent, Task
from courier_agent import CourierAgent

courier = CourierAgent()
inbox = courier.create_inbox()

email_agent = Agent(
    role="Email Handler",
    goal="Receive and process verification emails",
    tools=[]  # Courier handles via HTTP
)

# Agent can create inboxes and extract codes
# during multi-step CrewAI workflows
```
