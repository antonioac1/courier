#!/usr/bin/env python3
"""
Courier Integration Example — Python

Self-provision an operational inbox, receive a verification email,
and extract codes/magic links automatically.

Run: pip install requests && python3 courier-integration.py
"""

import requests
import json
import time

BASE_URL = "https://getcourier.dev"

class CourierAgent:
    """Autonomous agent interface to Courier."""
    
    def __init__(self, agent_id: str):
        self.agent_id = agent_id
        self.alias = None
        
    def provision_inbox(self, purpose: str = "agent-operations"):
        """Step 1: Self-provision an operational inbox (no auth required)."""
        r = requests.post(f"{BASE_URL}/alias", json={
            "purpose": purpose,
            "agent": self.agent_id
        })
        r.raise_for_status()
        data = r.json()
        self.alias = data["alias"]
        print(f"✅ Inbox provisioned: {self.alias}")
        return self.alias
    
    def send_verification_email(self, code: str = "839271-ABC-DEF"):
        """Step 2: Simulate a service sending a verification email to our alias."""
        email_body = (
            f"From: noreply@service.com\r\n"
            f"To: {self.alias}\r\n"
            f"Subject: Your verification code\r\n\r\n"
            f"Your verification code is {code}\r\n"
            f"Click here: https://service.com/verify?code={code}\r\n"
        )
        r = requests.post(
            f"{BASE_URL}/incoming",
            headers={
                "Content-Type": "message/rfc822",
                "X-Forwarded-To": self.alias
            },
            data=email_body
        )
        print(f"📨 Email sent: {r.status_code}")
        return r.ok
    
    def check_messages(self):
        """Step 3: Retrieve messages with automatic extraction."""
        r = requests.get(f"{BASE_URL}/messages")
        r.raise_for_status()
        return r.json()
    
    def extract_codes_and_links(self, messages_data: dict) -> list:
        """Step 4: Extract verification codes and magic links autonomously."""
        results = []
        for msg in messages_data[0].get("messages", []):
            results.append({
                "subject": msg.get("subject"),
                "codes": msg.get("codes", []),
                "links": msg.get("links", []),
                "type": msg.get("classification", {}).get("type")
            })
        return results


def main():
    """Complete autonomous workflow: provision → receive → extract."""
    
    agent = CourierAgent(agent_id="demo-python-agent")
    
    # Step 1: Provision
    alias = agent.provision_inbox(purpose="automated-testing")
    
    # Step 2: Receive a verification email
    agent.send_verification_email(code="743981-XYZ-123")
    
    # Brief pause for processing
    time.sleep(0.5)
    
    # Step 3: Retrieve with extraction
    messages = agent.check_messages()
    
    # Step 4: Use extracted information
    extracted = agent.extract_codes_and_links(messages)
    
    print("\n📋 Extracted Information:")
    for item in extracted:
        print(f"  Subject: {item['subject']}")
        if item['codes']:
            print(f"  Codes: {item['codes']}")
        if item['links']:
            print(f"  Links: {item['links']}")
        print(f"  Type: {item['type']}")
    
    print("\n✅ Autonomous email handling complete.")
    print(f"   Agent's inbox: {alias}")
    print(f"   Next step: use verification code {extracted[0]['codes'][0] if extracted and extracted[0]['codes'] else 'N/A'}")


if __name__ == "__main__":
    main()
