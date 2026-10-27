#!/usr/bin/env python3
"""
courier-agent-email - Temporary email inboxes for AI agents.

Zero dependencies (stdlib only). Give your agent email in under 5 seconds.
Receive OTP codes, magic links, verification emails, and password resets.

Usage:
    pip install courier-agent-email
    from courier_agent import CourierAgent

    agent = CourierAgent()
    inbox = agent.create_inbox()
    otp = agent.extract_otp()
    link = agent.extract_magic_link()
"""

import urllib.request
import json
import time
import os

BASE = os.environ.get("COURIER_API", "https://getcourier.dev")


class CourierAgent:
    """Temporary email inbox for AI agents. Zero dependencies."""

    def create_inbox(self, purpose="agent", agent="default"):
        """Create a disposable email inbox. No signup, no auth."""
        body = json.dumps({"purpose": purpose, "agent": agent}).encode()
        req = urllib.request.Request(
            f"{BASE}/alias",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read())
            return {
                "inbox": data.get("alias", {}).get("alias", data.get("alias")),
                "email": "{}@mail.getcourier.dev".format(
                    data.get("alias", {}).get("alias", data.get("alias"))
                ),
            }

    def get_messages(self, limit=50):
        """Get messages with extracted codes and links."""
        req = urllib.request.Request(f"{BASE}/messages?limit={limit}")
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())

    def wait_for_email(self, inbox=None, timeout=60, check_interval=3):
        """Poll until an email arrives. Handles delayed delivery."""
        start = time.time()
        while time.time() - start < timeout:
            data = self.get_messages()
            msgs = data.get("messages", [])
            if msgs:
                return msgs[0]
            time.sleep(check_interval)
        raise TimeoutError(f"No email after {timeout}s")

    def extract_otp(self, inbox=None):
        """Extract all OTP/verification codes."""
        data = self.get_messages()
        codes = []
        for msg in data.get("messages", []):
            for c in msg.get("codes", []):
                codes.append(c.get("code", c) if isinstance(c, dict) else c)
        return codes

    def extract_magic_link(self, inbox=None):
        """Extract all magic links and verification URLs."""
        data = self.get_messages()
        links = []
        for msg in data.get("messages", []):
            for l in msg.get("links", []):
                links.append(l.get("url", l) if isinstance(l, dict) else l)
        return links


if __name__ == "__main__":
    import sys
    agent = CourierAgent()
    cmd = sys.argv[1] if len(sys.argv) > 1 else "create"
    if cmd == "create":
        r = agent.create_inbox()
        print(f"Inbox: {r['inbox']}")
        print(f"Email: {r['email']}")
    elif cmd == "otp":
        codes = agent.extract_otp()
        for c in codes:
            print(f"  Code: {c}")
    elif cmd == "links":
        links = agent.extract_magic_link()
        for l in links:
            print(f"  Link: {l}")
