#!/usr/bin/env python3
"""Fetch ONE new trusted 1C min-max attachment from Gmail, privately.

Requires Gmail OAuth read-only refresh token. Never logs or uploads XLS bytes.
Leaves parsing and all SKU restrictions to import_minmax_email.py.
"""
from __future__ import annotations
import base64
from datetime import datetime, timedelta, timezone
from email.utils import parseaddr
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request

EXPECTED_FROM = "palleta.store@yandex.ru"
EXPECTED_SUBJECT = "Паллета 1С - Меню"
FILENAME = re.compile(r"^Отчет_Паллета 1С - Меню_\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.xls$")
MAX_BYTES = 25_000_000
ROOT = Path(__file__).resolve().parents[1]
MSK = timezone(timedelta(hours=3))


def stop(reason):
    raise RuntimeError("STOP: " + reason)


def request_json(url, *, token=None, post=None, context="Google API"):
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    if post is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    req = urllib.request.Request(url, headers=headers, data=urllib.parse.urlencode(post).encode() if post else None)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as exc:
        # Never print response bodies, URLs, tokens or credentials. Google OAuth
        # exposes a short machine-readable error code such as "invalid_grant";
        # whitelisting that code is enough to diagnose expired/revoked tokens.
        safe_error = None
        try:
            payload = json.loads(exc.read().decode("utf-8", errors="replace"))
            raw = payload.get("error")
            if isinstance(raw, dict):
                raw = raw.get("status")
            if isinstance(raw, str) and re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", raw):
                safe_error = raw
        except Exception:
            pass
        suffix = (" (" + safe_error + ")") if safe_error else ""
        stop(f"{context} failed: HTTP {exc.code}{suffix}")


def gmail_token():
    keys = ("GMAIL_OAUTH_CLIENT_ID", "GMAIL_OAUTH_CLIENT_SECRET", "GMAIL_OAUTH_REFRESH_TOKEN")
    if any(not os.environ.get(k) for k in keys):
        stop("required Gmail OAuth secrets missing")
    data = request_json("https://oauth2.googleapis.com/token", context="OAuth token refresh", post={
        "client_id": os.environ[keys[0]], "client_secret": os.environ[keys[1]],
        "refresh_token": os.environ[keys[2]], "grant_type": "refresh_token"
    })
    if not data.get("access_token"):
        stop("OAuth access token unavailable")
    return data["access_token"]


def gmail(token, path, params=None):
    url = "https://gmail.googleapis.com/gmail/v1/users/me/" + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    return request_json(url, token=token, context="Gmail API")


def headers(part):
    return {h.get("name", "").lower(): h.get("value", "") for h in part.get("payload", {}).get("headers", [])}


def parts(payload):
    yield payload
    for child in payload.get("parts", []):
        yield from parts(child)


def b64url(value):
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def fetch_candidate(token, msg):
    mid = msg["id"]
    raw = gmail(token, "messages/" + mid, {"format": "full"})
    h = {item.get("name", "").lower(): item.get("value", "") for item in raw.get("payload", {}).get("headers", [])}
    if parseaddr(h.get("from", ""))[1].lower() != EXPECTED_FROM or h.get("subject", "") != EXPECTED_SUBJECT:
        return None
    # Gmail search is not sender authentication. Require Gmail-reported authentication pass.
    auth = h.get("authentication-results", "").lower()
    if not re.search(r"\b(dmarc=pass|dkim=pass)\b", auth):
        stop("sender authentication cannot be confirmed by Gmail")
    timestamp = datetime.fromtimestamp(int(raw["internalDate"]) / 1000, tz=timezone.utc).astimezone(MSK)
    candidates = [p for p in parts(raw.get("payload", {})) if FILENAME.fullmatch(p.get("filename", ""))]
    if len(candidates) != 1:
        stop("expected one exact dated XLS attachment")
    part = candidates[0]
    body = part.get("body", {})
    size = body.get("size", 0)
    if not 0 < size <= MAX_BYTES:
        stop("invalid attachment size")
    if body.get("attachmentId"):
        payload = gmail(token, "messages/" + mid + "/attachments/" + urllib.parse.quote(body["attachmentId"], safe=""))
        encoded = payload.get("data", "")
    else:
        encoded = body.get("data", "")
    contents = b64url(encoded)
    if len(contents) != size or not contents.startswith(bytes.fromhex("D0CF11E0A1B11AE1")):
        stop("attachment byte length or BIFF/OLE signature invalid")
    return mid, part["filename"], timestamp.isoformat(timespec="seconds"), contents


def main():
    token = gmail_token()
    q = 'from:' + EXPECTED_FROM + ' subject:"' + EXPECTED_SUBJECT + '" has:attachment newer_than:2d'
    items = gmail(token, "messages", {"q": q, "maxResults": 20}).get("messages", [])
    if not items:
        print("NO_NEW_REPORT: no matching Gmail messages")
        return
    # Gmail messages list is newest first. Only the newest valid candidate is used.
    selected = None
    for item in items:
        selected = fetch_candidate(token, item)
        if selected:
            break
    if selected is None:
        print("NO_NEW_REPORT: no valid matching attachment")
        return
    mid, filename, sent, contents = selected
    with tempfile.TemporaryDirectory(prefix="palleta-private-") as tmp:
        source = Path(tmp) / filename
        source.write_bytes(contents)
        cmd = [
            sys.executable, str(ROOT / "tools/import_minmax_email.py"),
            "--xls", str(source), "--catalog", str(ROOT / "products.json"),
            "--allowlist", str(ROOT / "tools/club_price_allowlist.json"),
            "--identity-review", str(ROOT / "tools/sku_identity_review.json"),
            "--sender", EXPECTED_FROM, "--subject", EXPECTED_SUBJECT,
            "--email-sent-at", sent
        ]
        subprocess.run(cmd, cwd=ROOT, check=True)
        subprocess.run(cmd + ["--write"], cwd=ROOT, check=True)
    print("GMAIL_IMPORT_PASS: approved reference-price snapshot validated and locally updated")
    print("GMAIL_MESSAGE_ID_SHA_NOT_LOGGED; raw attachment discarded")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # Avoid echoing URLs, secrets, raw messages or payloads.
        print("GMAIL_IMPORT_STOP: " + (str(exc) if str(exc).startswith("STOP:") else type(exc).__name__), file=sys.stderr)
        raise SystemExit(2)
