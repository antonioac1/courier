# AutoGen Email Agent

**Problem:** AutoGen multi-agent conversations need email capability.

**Solution:** A Courier agent as an AutoGen assistant.

```python
import autogen
from courier_agent import CourierAgent

courier = CourierAgent()
inbox = courier.create_inbox()

email_assistant = autogen.AssistantAgent(
    name="EmailBot",
    system_message="I receive verification emails and extract codes."
)

# In conversation, other agents can use Courier
# to get OTPs, magic links, etc.
```
