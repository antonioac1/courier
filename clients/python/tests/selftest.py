#!/usr/bin/env python3
"""Standalone self-test for the getcourier package (no network, stdlib only).

Run from the package root:

    PYTHONPATH=src python3 tests/selftest.py

Patches getcourier.urllib.request.urlopen with a fake that returns canned JSON,
then exercises create / wait / 402 quota / delete / CLI no-args.
"""

import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(os.path.dirname(HERE), "src")
if SRC not in sys.path:
    sys.path.insert(0, SRC)

import getcourier  # noqa: E402
import getcourier.cli as cli  # noqa: E402

CALLS = []


class FakeResponse:
    """Minimal stand-in for http.client.HTTPResponse."""

    def __init__(self, payload, status=200, headers=None):
        self._body = json.dumps(payload).encode("utf-8") if not isinstance(payload, bytes) else payload
        self.status = status
        self.code = status
        self.headers = headers or {}

    def read(self):
        return self._body

    def getcode(self):
        return self.status

    def getheader(self, name, default=None):
        return self.headers.get(name, default)

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False


def make_fake(handler):
    """handler(request) -> FakeResponse | raises."""

    def fake_urlopen(req, data=None, timeout=None, **kwargs):
        CALLS.append({"url": req.full_url, "method": req.get_method(), "headers": dict(req.header_items()),
                      "body": req.data, "timeout": timeout})
        return handler(req)

    return fake_urlopen


def with_fake(handler, fn):
    real = getcourier.urllib.request.urlopen
    getcourier.urllib.request.urlopen = make_fake(handler)
    del CALLS[:]
    try:
        return fn()
    finally:
        getcourier.urllib.request.urlopen = real


def raise_http_error(status, payload, headers=None):
    body = io.BytesIO(json.dumps(payload).encode("utf-8"))
    err = getcourier.urllib.error.HTTPError(
        "https://getcourier.dev/x", status, "error", headers or {}, body
    )
    raise err


INBOX_PAYLOAD = {
    "address": "build-bot-k3xmqz@getcourier.dev",
    "alias": "build-bot-k3xmqz",
    "inbox_id": "5b40d4d6-c046-46c9-aaa1-d0f1e20194e0",
    "read_token": "rt_test_123",
    "expires_at": "2026-10-26T12:00:00.000Z",
    "ttl_hours": 72,
    "paid": False,
}


def check(condition, label):
    if not condition:
        raise AssertionError("FAILED: " + label)
    print("ok - " + label)


def test_create():
    def handler(req):
        return FakeResponse(INBOX_PAYLOAD)

    inbox = with_fake(handler, lambda: getcourier.create_inbox(purpose="signup", agent="build-bot-7"))

    check(isinstance(inbox, getcourier.Inbox), "create_inbox returns an Inbox")
    check(inbox.address == "build-bot-k3xmqz@getcourier.dev", "create_inbox address")
    check(inbox.alias == "build-bot-k3xmqz", "create_inbox alias")
    check(inbox.read_token == "rt_test_123", "create_inbox read_token")
    check(inbox.paid is False, "create_inbox paid flag")

    call = CALLS[0]
    check(call["method"] == "POST", "create_inbox posts")
    check(call["url"] == getcourier.DEFAULT_BASE_URL + "/alias", "create_inbox endpoint")
    headers = {k.lower(): v for k, v in call["headers"].items()}
    check(headers.get("user-agent") == "getcourier-py/0.1.0", "user-agent header")
    check(headers.get("accept") == "application/json", "accept header")
    check(headers.get("content-type") == "application/json", "content-type header")
    check(json.loads(call["body"].decode("utf-8")) == {"purpose": "signup", "agent": "build-bot-7"}, "post body")


def test_wait():
    def handler(req):
        return FakeResponse({"message": {"id": "m1", "subject": "Your code"}, "code": "482913", "link": None})

    hit = with_fake(handler, lambda: getcourier.wait_for_code("build-bot-k3xmqz", "rt_test_123", timeout=20))

    check(hit.timeout is False, "wait_for_code does not time out")
    check(hit.code == "482913", "wait_for_code code")
    check(isinstance(hit.message, dict) and hit.message["id"] == "m1", "wait_for_code message")

    call = CALLS[0]
    check("/v1/sandbox/inboxes/build-bot-k3xmqz/wait" in call["url"], "wait endpoint")
    check("timeout=" in call["url"], "wait passes timeout query")
    headers = {k.lower(): v for k, v in call["headers"].items()}
    check(headers.get("authorization") == "Bearer rt_test_123", "wait sends bearer token")

    # Timeout path: no message ever arrives -> returns timeout=True, no exception.
    empty = with_fake(lambda req: FakeResponse({}), lambda: getcourier.wait_for_code("a", "rt", timeout=1))
    check(empty.timeout is True and empty.code is None, "wait_for_code times out cleanly")


def test_quota():
    def handler(req):
        raise_http_error(
            402,
            {
                "code": "FREE_QUOTA_EXCEEDED",
                "message": "Free tier limit reached (5/day).",
                "retry_after_seconds": 900,
                "hint": "or use the hosted MCP server",
            },
            headers={"retry-after": "900"},
        )

    def run():
        try:
            getcourier.create_inbox(purpose="signup")
        except getcourier.QuotaExceeded as exc:
            return exc
        return None

    err = with_fake(handler, run)
    check(err is not None, "402 raises QuotaExceeded")
    check(isinstance(err, getcourier.GetCourierError), "QuotaExceeded is a GetCourierError")
    check(err.code == "FREE_QUOTA_EXCEEDED", "QuotaExceeded code")
    check(err.status == 402, "QuotaExceeded status")
    check(err.retryable is True, "QuotaExceeded retryable")
    check(err.retry_after == 900, "QuotaExceeded retry_after")
    check(err.retry_after_seconds == 900, "QuotaExceeded retry_after_seconds alias")
    check(err.hint == "or use the hosted MCP server", "QuotaExceeded hint")
    check("retry in 900" in "retry in {0}".format(err.retry_after), "retry_after readable")

    # Non-quota 402 is a plain PaymentRequired error.
    def handler2(req):
        raise_http_error(402, {"code": "PAYMENT_REQUIRED", "message": "credits needed"})

    def run2():
        try:
            getcourier.create_inbox(ttl_hours=720)
        except getcourier.PaymentRequired as exc:
            return exc
        return None

    err2 = with_fake(handler2, run2)
    check(isinstance(err2, getcourier.PaymentRequired), "other 402 raises PaymentRequired")
    check(err2.code == "PAYMENT_REQUIRED", "PaymentRequired code")

    # 500 is retryable, and a plain CourierError.
    def handler3(req):
        raise_http_error(500, {"message": "boom"})

    def run3():
        try:
            getcourier.pricing()
        except getcourier.GetCourierError as exc:
            return exc
        return None

    err3 = with_fake(handler3, run3)
    check(err3.code == "HTTP_500" and err3.retryable is True, "500 is a retryable GetCourierError")


def test_delete():
    deleted = with_fake(lambda req: FakeResponse({"success": True}), lambda: getcourier.delete_inbox("build-bot-k3xmqz", "rt_test_123"))
    check(deleted == {"success": True}, "delete_inbox returns success")
    call = CALLS[0]
    check(call["method"] == "DELETE", "delete_inbox uses DELETE")
    check(call["url"].endswith("/v1/sandbox/inboxes/build-bot-k3xmqz"), "delete endpoint")


def test_cli_no_args():
    real_create = cli.create_inbox
    real_stdout = sys.stdout
    cli.create_inbox = lambda **kwargs: getcourier._normalize_inbox(INBOX_PAYLOAD)
    buf = io.StringIO()
    try:
        with_fake(lambda req: FakeResponse(INBOX_PAYLOAD), lambda: None)
        sys.stdout = buf
        code = cli.main([])
    finally:
        sys.stdout = real_stdout
        cli.create_inbox = real_create

    out = buf.getvalue()
    check(code == 0, "CLI no-args exits 0")
    payload = json.loads(out)
    check(payload["address"] == "build-bot-k3xmqz@getcourier.dev", "CLI prints address")
    check(payload["read_token"] == "rt_test_123", "CLI prints read_token")
    check(payload["alias"] == "build-bot-k3xmqz", "CLI prints alias")

    # --help exits 0 and mentions usage
    buf2 = io.StringIO()
    sys.stdout = buf2
    try:
        help_code = cli.main(["--help"])
    finally:
        sys.stdout = real_stdout
    check(help_code == 0 and "Usage:" in buf2.getvalue(), "CLI --help works")

    # bad args exit 2
    check(cli.parse_args(["--wait", "--purpose", "x"])["wait"] is True, "parse_args --wait")
    check(cli.parse_args(["wait", "my-alias", "--token", "rt"])["alias"] == "my-alias", "parse_args wait alias")
    try:
        cli.parse_args(["--bogus"])
        bad = False
    except getcourier.GetCourierError:
        bad = True
    check(bad, "parse_args rejects unknown options")


def main():
    tests = [test_create, test_wait, test_quota, test_delete, test_cli_no_args]
    for test in tests:
        print("-- " + test.__name__)
        test()
    print("ALL PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
