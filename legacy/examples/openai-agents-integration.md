# Courier × OpenAI Agents SDK — Integration Guide

This guide shows how to use Courier within OpenAI's Agents SDK
to give your agent the ability to receive emails autonomously.

## Prerequisites

```bash
pip install openai requests
```

## Agent Definition

```python
import requests
from openai import OpenAI

BASE_URL = "https://getcourier.dev"


def provision_inbox(purpose: str = "operational", agent_id: str = "gpt-agent") -> str:
    """Self-provision an operational inbox without human approval.
    
    Args:
        purpose: Why the inbox is needed (logged for telemetry)
        agent_id: Unique identifier for this agent session
        
    Returns:
        The inbox alias (e.g. gpt-agent@inbox.getcourier.dev)
    """
    r = requests.post(f"{BASE_URL}/alias", json={
        "purpose": purpose,
        "agent": agent_id
    })
    r.raise_for_status()
    return r.json()["alias"]


def check_inbox() -> list:
    """Check for new messages with codes and links extracted.
    
    Returns:
        List of messages with extracted verification codes and magic links
    """
    r = requests.get(f"{BASE_URL}/messages")
    r.raise_for_status()
    
    results = []
    data = r.json()
    for msg in data[0].get("messages", []):
        results.append({
            "subject": msg.get("subject"),
            "from": msg.get("from"),
            "codes": msg.get("codes", []),
            "links": msg.get("links", []),
            "classification": msg.get("classification", {}).get("type"),
            "raw_text": msg.get("text", "")[:500]
        })
    return results


def verify_code(purpose: str = "signup", agent_id: str = "gpt-agent") -> dict:
    """Complete workflow: provision inbox, receive code, return extracted data.
    
    Call this when your agent needs to receive a verification code
    from a service that sends it via email.
    
    Args:
        purpose: Why verification is needed
        agent_id: Agent identifier
        
    Returns:
        dict with alias, codes, links, and classification
    """
    alias = provision_inbox(purpose, agent_id)
    inbox = check_inbox()
    
    return {
        "alias": alias,
        "messages": inbox,
        "action_required": any(
            m.get("codes") or m.get("links")
            for m in inbox
        )
    }
```

## Usage with OpenAI Responses API

```python
from openai import OpenAI

client = OpenAI()

# Agent workflow: sign up for a service, receive the verification
# email via Courier, and complete the signup autonomously
response = client.responses.create(
    model="gpt-4o",
    tools=[{
        "type": "function",
        "function": {
            "name": "verify_code",
            "description": "Provision a temporary inbox, check for verification codes, and return extracted data",
            "parameters": {
                "type": "object",
                "properties": {
                    "purpose": {"type": "string", "description": "Why verification is needed (e.g. signup, password-reset)"},
                    "agent_id": {"type": "string", "description": "Unique agent identifier"}
                }
            }
        }
    }],
    messages=[
        {"role": "system", "content": "You are an autonomous agent that can sign up for services. Use verify_code when you need to receive verification emails."},
        {"role": "user", "content": "Sign up for the developer newsletter at newsletter.dev and confirm the verification email."}
    ]
)

# The agent will call verify_code(), Courier will handle the rest
```

## Usage with OpenAI Agents SDK

```python
from agents import Agent, function_tool

@function_tool
def provision_inbox(purpose: str, agent_id: str) -> str:
    """Request a temporary operational inbox for receiving emails."""
    import requests
    r = requests.post("https://getcourier.dev/alias",
        json={"purpose": purpose, "agent": agent_id})
    return r.json()["alias"]

@function_tool
def check_inbox() -> str:
    """Check the inbox and return extracted codes, links, and message content."""
    import requests
    r = requests.get("https://getcourier.dev/messages")
    return str(r.json())

agent = Agent(
    name="CourierAgent",
    instructions="""You are an autonomous agent that can receive emails.
Use provision_inbox to create a temporary inbox.
Use check_inbox to read verification codes from received emails.""",
    tools=[provision_inbox, check_inbox]
)
```

## Full Example

```python
import requests

# Step 1: Create an inbox
r = requests.post("https://getcourier.dev/alias",
    json={"purpose": "newsletter-signup", "agent": "demo-gpt-001"})
alias = r.json()["alias"]
print(f"Inbox: {alias}")

# Step 2 (service sends email to alias — happens externally)

# Step 3: Agent checks for verification code
r = requests.get("https://getcourier.dev/messages")
for msg in r.json()[0].get("messages", []):
    if msg.get("codes"):
        print(f"Found code: {msg['codes'][0]}")
        # Agent uses code to complete signup
```

## Notes

- No API key or authentication is required for alias provisioning
- Messages have a TTL and are automatically cleaned up
- For production, self-host Courier on your own infrastructure
- Full API docs: https://getcourier.dev/capabilities
