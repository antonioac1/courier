"""getcourier — client for the hosted GetCourier API (https://getcourier.dev).

Stdlib only (urllib). Requires Python >= 3.9.

    from getcourier import create_inbox, wait_for_code

    inbox = create_inbox(purpose="signing up for an API key")
    hit = wait_for_code(inbox.alias, inbox.read_token, timeout=60)
    print(hit.code)
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

__version__ = "0.1.0"

VERSION = __version__
USER_AGENT = "getcourier-py/" + VERSION
DEFAULT_BASE_URL = "https://getcourier.dev"
MAX_WAIT_SECONDS = 55  # server clamps `timeout` to 1..55
RETRY_SLICE_SECONDS = 0.05  # pause between completed long-polls

__all__ = [
    "__version__",
    "VERSION",
    "USER_AGENT",
    "DEFAULT_BASE_URL",
    "MAX_WAIT_SECONDS",
    "GetCourierError",
    "CourierError",
    "QuotaExceeded",
    "PaymentRequired",
    "Inbox",
    "WaitResult",
    "create_inbox",
    "wait_for_code",
    "list_messages",
    "get_message",
    "delete_inbox",
    "pricing",
]


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class GetCourierError(Exception):
    """Error raised for any non-2xx response (and for transport failures).

    `code` mirrors the API error code, e.g. FREE_QUOTA_EXCEEDED.
    """

    def __init__(
        self,
        message,
        code="COURIER_ERROR",
        status=None,
        retryable=False,
        retry_after=None,
        hint=None,
        request_id=None,
        payment=None,
        body=None,
    ):
        super().__init__(message)
        self.message = message
        self.code = code or "COURIER_ERROR"
        self.status = status if isinstance(status, int) else None
        self.retryable = bool(retryable)
        self.retry_after = retry_after if isinstance(retry_after, (int, float)) else None
        self.hint = hint
        self.request_id = request_id
        self.payment = payment
        self.body = body

    @property
    def retry_after_seconds(self):
        """Alias of `retry_after`, matching the API field name."""
        return self.retry_after

    def to_dict(self):
        return {
            "error": True,
            "code": self.code,
            "message": self.message,
            "status": self.status,
            "retryable": self.retryable,
            "retry_after_seconds": self.retry_after,
            "hint": self.hint,
            "request_id": self.request_id,
        }

    def __str__(self):
        return self.message


# Backwards/forwards-friendly aliases.
CourierError = GetCourierError


class QuotaExceeded(GetCourierError):
    """402 with code FREE_QUOTA_EXCEEDED: the free tier (3/hour, 5/day per IP) is used up."""

    def __init__(self, message, **options):
        options.pop("code", None)
        options["retryable"] = True
        super().__init__(message, code="FREE_QUOTA_EXCEEDED", **options)


class PaymentRequired(GetCourierError):
    """402 for paid usage: longer inboxes / credits needed."""

    def __init__(self, message, **options):
        options.setdefault("code", "PAYMENT_REQUIRED")
        super().__init__(message, **options)


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------


class Inbox:
    """Result of create_inbox()."""

    __slots__ = (
        "address",
        "alias",
        "inbox_id",
        "read_token",
        "expires_at",
        "ttl_hours",
        "paid",
        "identity",
        "links",
        "charged_credits",
        "balance",
        "raw",
    )

    def __init__(self, **fields):
        for key in self.__slots__:
            setattr(self, key, fields.get(key))

    def __repr__(self):
        return "Inbox(address={0!r}, alias={1!r}, inbox_id={2!r}, paid={3!r})".format(
            self.address, self.alias, self.inbox_id, self.paid
        )

    def __getitem__(self, key):
        try:
            return getattr(self, key)
        except AttributeError:
            raise KeyError(key)

    def get(self, key, default=None):
        return getattr(self, key, default)

    def to_dict(self):
        return {key: getattr(self, key) for key in self.__slots__}


class WaitResult:
    """Result of wait_for_code(): message/code/link are None on deadline expiry."""

    __slots__ = ("message", "code", "link", "timeout")

    def __init__(self, message=None, code=None, link=None, timeout=True):
        self.message = message
        self.code = code
        self.link = link
        self.timeout = bool(timeout)

    def __repr__(self):
        return "WaitResult(code={0!r}, link={1!r}, timeout={2!r})".format(self.code, self.link, self.timeout)

    def __getitem__(self, key):
        try:
            return getattr(self, key)
        except AttributeError:
            raise KeyError(key)

    def get(self, key, default=None):
        return getattr(self, key, default)

    def to_dict(self):
        return {"code": self.code, "link": self.link, "timeout": self.timeout, "message": self.message}


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _base_url():
    raw = os.environ.get("GETCOURIER_BASE_URL") or DEFAULT_BASE_URL
    return str(raw).rstrip("/")


def _parse_retry_after(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        pass
    try:
        # HTTP-date form
        from email.utils import parsedate_to_datetime

        dt = parsedate_to_datetime(str(value))
        if dt is not None:
            return max(0.0, round(dt.timestamp() - time.time()))
    except Exception:
        pass
    return None


def _error_from_response(status, headers, data):
    body = data if isinstance(data, dict) else {}
    code = body.get("code") or body.get("error") or "HTTP_{0}".format(status)
    message = body.get("message")
    if not message:
        message = body.get("error") if isinstance(body.get("error"), str) else "Request failed with HTTP {0}".format(status)

    retry_after = body.get("retry_after_seconds")
    if not isinstance(retry_after, (int, float)):
        retry_after = _parse_retry_after(headers.get("retry-after") if headers else None)

    if body.get("retryable") is not None:
        retryable = bool(body.get("retryable"))
    else:
        retryable = status == 429 or status >= 500

    options = dict(
        status=status,
        retryable=retryable,
        retry_after=retry_after,
        hint=body.get("hint"),
        request_id=body.get("request_id"),
        payment=body.get("payment"),
        body=body,
    )

    if status == 402 and code == "FREE_QUOTA_EXCEEDED":
        return QuotaExceeded(message, **options)
    if status == 402:
        return PaymentRequired(message, code=code, **options)
    return GetCourierError(message, code=code, **options)


def _request(path, method="GET", body=None, token=None, query=None, headers=None, timeout=None):
    url = _base_url() + path
    if query:
        pairs = []
        for key, value in query.items():
            if value is None or value == "":
                continue
            pairs.append((key, str(value)))
        if pairs:
            sep = "&" if urllib.parse.urlsplit(url).query else "?"
            url = url + sep + urllib.parse.urlencode(pairs)

    final_headers = {
        "Accept": "application/json",
        "User-Agent": USER_AGENT,
    }
    if headers:
        final_headers.update(headers)
    payload = None
    if body is not None:
        payload = json.dumps(body).encode("utf-8")
        final_headers["Content-Type"] = "application/json"
    if token:
        final_headers["Authorization"] = "Bearer " + str(token)

    req = urllib.request.Request(url, data=payload, headers=final_headers, method=method)

    if timeout is None:
        timeout = MAX_WAIT_SECONDS + 15
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:  # noqa: S310 - documented API host
            status = getattr(res, "status", None) or res.getcode()
            res_headers = res.headers
            text = res.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as err:
        try:
            text = err.read().decode("utf-8", "replace")
        except Exception:
            text = ""
        raise _error_from_response(err.code, err.headers, _decode(text)) from None
    except urllib.error.URLError as err:
        raise GetCourierError(
            "Network error talking to {0}: {1}".format(_origin(url), getattr(err, "reason", err)),
            code="NETWORK_ERROR",
            retryable=True,
        ) from None

    return _decode(text)


def _decode(text):
    if not text:
        return None
    try:
        return json.loads(text)
    except ValueError:
        return {"raw": text}


def _origin(url):
    parts = urllib.parse.urlsplit(url)
    return "{0}://{1}".format(parts.scheme, parts.netloc) if parts.scheme else url


def _normalize_inbox(data):
    body = data if isinstance(data, dict) else {}
    alias_field = body.get("alias")
    if isinstance(alias_field, dict):
        alias_field = alias_field.get("alias")
    alias = alias_field
    if not alias and isinstance(body.get("address"), str):
        alias = body.get("address").split("@")[0]

    return Inbox(
        address=body.get("address"),
        alias=alias,
        inbox_id=body.get("inbox_id"),
        read_token=body.get("read_token"),
        expires_at=body.get("expires_at"),
        ttl_hours=body.get("ttl_hours"),
        paid=bool(body.get("paid")),
        identity=body.get("identity"),
        links=body.get("links"),
        charged_credits=body.get("charged_credits"),
        balance=body.get("balance"),
        raw=body,
    )


def _clamp_wait_seconds(value):
    try:
        n = float(value)
    except (TypeError, ValueError):
        return 30
    if n != n:  # NaN
        return 30
    import math

    return min(MAX_WAIT_SECONDS, max(1, int(math.ceil(n))))


def _resolve_inbox(inbox, token=None, read_token=None):
    """Accepts an Inbox object (create_inbox result), a raw dict, or an alias string."""
    if isinstance(inbox, str):
        alias = inbox.strip()
        if not alias:
            raise GetCourierError("An inbox alias is required.", code="BAD_REQUEST")
        tok = read_token or token
        if not tok:
            raise GetCourierError("A read_token is required to read an inbox.", code="UNAUTHORIZED")
        return alias, tok

    if isinstance(inbox, dict):
        inbox = Inbox(**{key: inbox.get(key) for key in Inbox.__slots__ if key in inbox}) if "alias" in inbox or "read_token" in inbox else inbox

    alias = getattr(inbox, "alias", None)
    if not alias:
        address = getattr(inbox, "address", None)
        if isinstance(address, str):
            alias = address.split("@")[0]
    read_tok = (
        getattr(inbox, "read_token", None)
        or (inbox.get("read_token") if isinstance(inbox, dict) else None)
        or read_token
        or token
    )
    if not alias:
        raise GetCourierError("Inbox object has no alias/address.", code="BAD_REQUEST")
    if not read_tok:
        raise GetCourierError("Inbox object has no read_token.", code="UNAUTHORIZED")
    return alias, read_tok


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def create_inbox(alias=None, purpose=None, agent=None, ttl_hours=None, account_key=None, timeout=None):
    """Create an inbox. POST /alias — no auth, no signup.

    Returns an Inbox. `purpose` is what the inbox is for (<= 200 chars),
    `agent` is an agent name (<= 100 chars); `alias` gets a 6-char suffix.
    """
    body = {}
    if alias is not None:
        body["alias"] = alias
    if purpose is not None:
        body["purpose"] = purpose
    if agent is not None:
        body["agent"] = agent
    if ttl_hours is not None:
        body["ttl_hours"] = ttl_hours

    data = _request("/alias", method="POST", body=body, token=account_key, timeout=timeout)
    return _normalize_inbox(data)


def wait_for_code(alias, read_token=None, timeout=120, after=None, token=None):
    """Long-poll GET /v1/sandbox/inboxes/{alias}/wait until a code or magic link arrives.

    Each poll uses the server's timeout (1..55s); polls repeat until the overall
    `timeout` (seconds) deadline. Returns a WaitResult; on deadline expiry
    message/code/link are None and timeout is True.
    """
    alias_value, read_tok = _resolve_inbox(alias, token=token, read_token=read_token)

    try:
        total_seconds = float(timeout)
    except (TypeError, ValueError):
        total_seconds = 30.0
    if not (total_seconds > 0) or total_seconds != total_seconds:
        total_seconds = 30.0

    deadline = time.monotonic() + total_seconds
    last = WaitResult()
    after_id = after
    quoted = urllib.parse.quote(str(alias_value), safe="")

    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return last

        poll_seconds = _clamp_wait_seconds(remaining)

        try:
            data = _request(
                "/v1/sandbox/inboxes/{0}/wait".format(quoted),
                query={"timeout": poll_seconds, "after": after_id},
                token=read_tok,
                timeout=poll_seconds + 15,
            )
        except GetCourierError as err:
            # Retryable API errors (429, retryable 402) are retried while time remains.
            if err.retryable and err.retry_after is not None:
                wait_s = min(float(err.retry_after), max(0.0, deadline - time.monotonic()))
                if wait_s > 0:
                    time.sleep(wait_s)
                    continue
            raise

        if isinstance(data, dict) and data.get("message"):
            return WaitResult(
                message=data.get("message"),
                code=data.get("code"),
                link=data.get("link"),
                timeout=False,
            )

        last = WaitResult()
        if remaining - RETRY_SLICE_SECONDS <= 0:
            return last
        time.sleep(RETRY_SLICE_SECONDS)


def list_messages(alias, read_token=None, after=None, limit=None, token=None, timeout=None):
    """List messages: GET /v1/sandbox/inboxes/{alias}/messages"""
    alias_value, read_tok = _resolve_inbox(alias, token=token, read_token=read_token)
    return _request(
        "/v1/sandbox/inboxes/{0}/messages".format(urllib.parse.quote(str(alias_value), safe="")),
        query={"after": after, "limit": limit},
        token=read_tok,
        timeout=timeout,
    )


def get_message(alias, message_id, read_token=None, token=None, timeout=None):
    """Fetch one message: GET /v1/sandbox/inboxes/{alias}/messages/{id}"""
    if not message_id:
        raise GetCourierError("A message id is required.", code="BAD_REQUEST")
    alias_value, read_tok = _resolve_inbox(alias, token=token, read_token=read_token)
    return _request(
        "/v1/sandbox/inboxes/{0}/messages/{1}".format(
            urllib.parse.quote(str(alias_value), safe=""),
            urllib.parse.quote(str(message_id), safe=""),
        ),
        token=read_tok,
        timeout=timeout,
    )


def delete_inbox(alias, read_token=None, token=None, timeout=None):
    """Delete (disable) an inbox: DELETE /v1/sandbox/inboxes/{alias}"""
    alias_value, read_tok = _resolve_inbox(alias, token=token, read_token=read_token)
    data = _request(
        "/v1/sandbox/inboxes/{0}".format(urllib.parse.quote(str(alias_value), safe="")),
        method="DELETE",
        token=read_tok,
        timeout=timeout,
    )
    success = True
    if isinstance(data, dict):
        success = data.get("success") is not False
    return {"success": success}


def pricing(timeout=None):
    """Public pricing: GET /v1/pricing"""
    return _request("/v1/pricing", timeout=timeout)
