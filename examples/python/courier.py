#!/usr/bin/env python3
"""
Courier - Email for AI Agents

Single-file Python client. Zero dependencies (stdlib only).
Give your agent an email inbox in under 5 seconds.

Usage:
    from courier import Courier
    c = Courier()
    inbox = c.create_inbox()
    email = c.wait_for_email(inbox, timeout=60)
    code = c.extract_otp(inbox)
    link = c.extract_magic_link(inbox)
"""

import urllib.request
import json
import time
import os

BASE = os.environ.get('COURIER_API', 'https://getcourier.dev')


class Courier:
    """Minimal Courier client for AI agents."""

    def create_inbox(self, purpose="agent", agent="default"):
        """Create a disposable email inbox. No signup, no auth."""
        body = json.dumps({"purpose": purpose, "agent": agent}).encode()
        req = urllib.request.Request(
            f"{BASE}/alias",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read())
            return {
                "inbox": data["alias"]["alias"] if "alias" in data else data["alias"],
                "email": f"{data['alias']['alias'] if 'alias' in data else data['alias']}@mail.getcourier.dev",
                "raw": data
            }

    def get_messages(self, limit=50):
        """Get all messages from the inbox."""
        req = urllib.request.Request(f"{BASE}/messages?limit={limit}")
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())

    def wait_for_email(self, inbox=None, timeout=60, check_interval=3):
        """Poll until an email arrives. Returns first email."""
        start = time.time()
        while time.time() - start < timeout:
            data = self.get_messages()
            msgs = data.get("messages", [])
            if msgs:
                return msgs[0]
            time.sleep(check_interval)
        raise TimeoutError(f"No email after {timeout}s")

    def extract_otp(self, inbox=None):
        """Extract all verification codes from inbox."""
        data = self.get_messages()
        codes = []
        for msg in data.get("messages", []):
            for c in msg.get("codes", []):
                codes.append({
                    "code": c,
                    "subject": msg.get("subject"),
                    "from": msg.get("from")
                })
        return codes

    def extract_magic_link(self, inbox=None):
        """Extract all magic links and verification URLs from inbox."""
        data = self.get_messages()
        links = []
        for msg in data.get("messages", []):
            for l in msg.get("links", []):
                links.append({
                    "link": l,
                    "subject": msg.get("subject"),
                    "from": msg.get("from")
                })
        return links


# --- CLI ---

if __name__ == "__main__":
    import sys
    c = Courier()

    if len(sys.argv) < 2:
        print("Usage: courier.py [create|messages|wait|otp|link]")
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "create":
        result = c.create_inbox()
        print(f"Inbox created: {result['inbox']}")
        print(f"Email: {result['email']}")

    elif cmd == "messages":
        data = c.get_messages()
        print(f"{len(data.get('messages', []))} messages")
        for m in data.get("messages", [])[:5]:
            print(f"  [{m.get('id')}] {m.get('subject', 'no subject')}")

    elif cmd == "wait":
        timeout = int(sys.argv[2]) if len(sys.argv) > 2 else 60
        print(f"Waiting for email (timeout={timeout}s)...")
        try:
            msg = c.wait_for_email(timeout=timeout)
            print(f"Email received!")
            print(f"   From: {msg.get('from')}")
            print(f"   Subject: {msg.get('subject')}")
            print(f"   Codes: {msg.get('codes', [])}")
            print(f"   Links: {msg.get('links', [])}")
        except TimeoutError as e:
            print(f"Timeout: {e}")
            sys.exit(1)

    elif cmd == "otp":
        codes = c.extract_otp()
        if codes:
            print(f"{len(codes)} code(s) found:")
            for c in codes:
                print(f"   {c['code']} (from: {c['subject']})")
        else:
            print("No codes found")

    elif cmd == "link":
        links = c.extract_magic_link()
        if links:
            print(f"{len(links)} link(s) found:")
            for l in links:
                print(f"   {l['link']} (from: {l['subject']})")
        else:
            print("No links found")
