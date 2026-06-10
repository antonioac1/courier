# LangGraph Email Verification Node

**Problem:** LangGraph state machines need email verification as a node in the graph.

**Solution:** Add Courier as a simple API call in your LangGraph node.

```python
from courier_agent import CourierAgent
from langgraph.graph import StateGraph

# Define an email verification node
def verify_email_node(state):
    agent = CourierAgent()
    inbox = agent.create_inbox()
    state["email"] = inbox["email"]
    # ... service sends OTP to state["email"] ...
    otp = agent.extract_otp()
    state["otp"] = otp
    return state

# Add to your graph
graph.add_node("verify_email", verify_email_node)
```
