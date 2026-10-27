#!/usr/bin/env python3
"""getcourier CLI.

    python -m getcourier                     # create an inbox, print address + read_token
    getcourier new [--wait] [--purpose P] [--agent A] [--alias A] [--timeout S]
    getcourier wait <alias> --token T [--timeout 120] [--after MSG_ID]
    getcourier --help

JSON goes to stdout, errors to stderr, non-zero exit on error.
"""

from __future__ import annotations

import json
import sys

from . import (
    GetCourierError,
    VERSION,
    create_inbox,
    delete_inbox,
    get_message,
    list_messages,
    pricing as pricing_call,
    wait_for_code,
)

DEFAULT_WAIT_TIMEOUT = 120

USAGE = """getcourier {version} — email inboxes for AI agents (getcourier.dev)

Usage:
  getcourier                          Create an inbox; prints address + read_token as JSON
  getcourier new [options]            Same as above, with options
  getcourier wait <alias> --token T   Long-poll for a verification code or magic link
  getcourier --help                   Show this help

Options:
  --wait                 (new) wait for the first code/link after creating the inbox
  --purpose <text>       What the inbox is for (<= 200 chars)
  --agent <name>         Agent name (<= 100 chars)
  --alias <name>         Requested alias; a 6-char suffix is appended
  --token, -t <token>    read_token for the inbox (required by `wait`)
  --timeout <seconds>    Total wait time (default {timeout})
  --after <message_id>   Only consider messages newer than this id
  -h, --help             Show this help

Environment:
  GETCOURIER_BASE_URL    Override the API base (default https://getcourier.dev)

Examples:
  python -m getcourier
  python -m getcourier new --purpose "signup" --wait --timeout 90
  python -m getcourier wait my-agent-k3xmqz --token rt_... --timeout 120

MCP alternative (no install, no token juggling):
  claude mcp add --transport http getcourier https://getcourier.dev/mcp
""".format(version=VERSION, timeout=DEFAULT_WAIT_TIMEOUT)

COMMANDS = {"new", "create", "wait", "help"}

VALUE_OPTIONS = {
    "--token": "token",
    "-t": "token",
    "--timeout": "timeout",
    "-T": "timeout",
    "--after": "after",
    "--purpose": "purpose",
    "--agent": "agent",
    "--alias": "alias",
    "-a": "alias",
}


def parse_args(argv=None):
    args = list(argv if argv is not None else [])
    parsed = {
        "command": None,
        "alias": None,
        "token": None,
        "timeout": None,
        "after": None,
        "purpose": None,
        "agent": None,
        "wait": False,
        "help": False,
    }

    positional = []
    i = 0
    while i < len(args):
        arg = args[i]
        i += 1

        if arg in ("--help", "-h", "help"):
            parsed["help"] = True
            continue
        if arg in ("--wait", "-w"):
            parsed["wait"] = True
            continue

        matched = False
        for flag, key in VALUE_OPTIONS.items():
            if arg == flag:
                parsed[key] = args[i] if i < len(args) else None
                i += 1
                matched = True
                break
            if arg.startswith(flag + "="):
                parsed[key] = arg[len(flag) + 1:]
                matched = True
                break
        if matched:
            continue

        if arg.startswith("-") and arg != "-":
            raise GetCourierError("Unknown option: {0}. Run `getcourier --help`.".format(arg), code="BAD_ARGS")
        positional.append(arg)

    if positional and positional[0] in COMMANDS:
        parsed["command"] = "new" if positional[0] == "create" else positional[0]
        positional.pop(0)
        if parsed["command"] == "help":
            parsed["help"] = True

    # A trailing positional after `new` is not an alias (avoid surprises); for
    # `wait` the first positional is the alias.
    if not parsed["command"] and not positional:
        parsed["command"] = "new"
    if parsed["command"] == "wait" and positional:
        parsed["alias"] = parsed["alias"] or positional.pop(0)

    if parsed["timeout"] is not None:
        try:
            seconds = float(parsed["timeout"])
        except (TypeError, ValueError):
            seconds = None
        if seconds is None or seconds != seconds or seconds <= 0:
            raise GetCourierError(
                "Invalid --timeout: {0} (expected seconds > 0).".format(parsed["timeout"]), code="BAD_ARGS"
            )
        parsed["timeout"] = seconds

    return parsed


def inbox_json(inbox):
    return {
        "address": inbox.address,
        "alias": inbox.alias,
        "inbox_id": inbox.inbox_id,
        "read_token": inbox.read_token,
        "expires_at": inbox.expires_at,
        "ttl_hours": inbox.ttl_hours,
        "paid": inbox.paid,
    }


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)

    def out(text):
        sys.stdout.write(str(text))

    def err(text):
        sys.stderr.write(str(text))

    def emit(obj):
        out(json.dumps(obj, indent=2) + "\n")

    def fail(message, code):
        err("getcourier: {0}\n".format(message))
        return code

    try:
        args = parse_args(argv)
    except GetCourierError as exc:
        return fail(exc.message, 2)

    if args["help"] or args["command"] == "help":
        out(USAGE)
        return 0

    try:
        if args["command"] == "wait":
            if not args["alias"]:
                return fail("missing <alias>. Usage: getcourier wait <alias> --token <read_token>", 2)
            if not args["token"]:
                return fail("missing --token <read_token>. Usage: getcourier wait <alias> --token <read_token>", 2)
            wait_timeout = args["timeout"] or DEFAULT_WAIT_TIMEOUT
            result = wait_for_code(
                args["alias"],
                args["token"],
                timeout=wait_timeout,
                after=args["after"] or None,
            )
            if result.timeout or not result.message:
                emit({"code": None, "link": None, "timeout": True})
                fail(
                    "timed out after {0}s waiting for a message with a code or link".format(
                        _fmt_seconds(wait_timeout)
                    ),
                    3,
                )
                return 3
            emit({"code": result.code, "link": result.link, "timeout": False, "message": result.message})
            return 0

        # default / `new`
        inbox = create_inbox(
            alias=args["alias"] or None,
            purpose=args["purpose"] or None,
            agent=args["agent"] or None,
        )

        if not args["wait"]:
            emit(inbox_json(inbox))
            return 0

        wait_timeout = args["timeout"] or DEFAULT_WAIT_TIMEOUT
        result = wait_for_code(
            inbox.alias,
            inbox.read_token,
            timeout=wait_timeout,
            after=args["after"] or None,
        )
        payload = inbox_json(inbox)
        payload.update(
            {
                "code": result.code,
                "link": result.link,
                "timeout": result.timeout,
                "message": result.message,
            }
        )
        emit(payload)
        if result.timeout:
            fail(
                "inbox {0} created, but no code/link arrived within {1}s".format(
                    inbox.address, _fmt_seconds(wait_timeout)
                ),
                3,
            )
            return 3
        return 0
    except GetCourierError as exc:
        message = exc.message if isinstance(exc, GetCourierError) else str(exc)
        code = " [{0}]".format(exc.code) if getattr(exc, "code", None) else ""
        fail("{0}{1}".format(message, code), 1)
        if getattr(exc, "retry_after", None) is not None:
            err("getcourier: retry after {0}s\n".format(_fmt_seconds(exc.retry_after)))
        return 1
    except (OSError, ValueError, RuntimeError) as exc:
        return fail(str(exc), 1)


def _fmt_seconds(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return str(value)
    return str(int(number)) if number == int(number) else str(number)


# Extra helpers, mirroring the Node client surface (not used by main()).
def messages(alias, read_token, limit=20):
    return list_messages(alias, read_token, limit=limit)


def message(alias, read_token, message_id):
    return get_message(alias, read_token, message_id)


def remove(alias, read_token):
    return delete_inbox(alias, read_token)


def price():
    return pricing_call()


if __name__ == "__main__":
    raise SystemExit(main())
