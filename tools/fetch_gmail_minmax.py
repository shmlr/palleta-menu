#!/usr/bin/env python3
"""Read a verified Palleta min-max binary XLS via Gmail API RAW.

Never sends raw XLS/stock/costs to GitHub. OAuth: gmail.readonly.
"""
from __future__ import annotations

import argparse
import base64
from datetime import datetime, timedelta, timezone
from email import policy
from email.parser import BytesParser
from email.utils import parseaddr
import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import urlencode
from urllib.request import Request, urlopen

EXPECTED_SENDER = "palleta.store@yandex.ru"
EXPECTED_SUBJECT = "Паллета 1С - Меню"
NAME = re.compile(r"^Отчет_Паллета 1С - Меню_(\d{4}-\d{2}-\d{2} \d{2}-\d{2})\.xls$")
MSK = timezone(timedelta(hours=3))
MAX_XLS = 25_000_000
MAX_RAW = 45_000_000


class SourceError(Exception):
    pass


def check(condition, message):
    if not condition:
        raise SourceError(message)


def decode64(value):
    check(isinstance(value, str) and 0 < len(value) <= MAX_RAW * 2, "invalid or oversized raw message")
    value = value.replace("-", "+").replace("_", "/")
    value += "=" * (-len(value) % 4)
    try:
        return base64.b64decode(value, validate=True)
    except (ValueError, base64.binascii.Error) as e:
        raise SourceError("invalid Gmail raw base64") from e


def authenticated(email_message):
    # Only Google's own authentication result is accepted; From alone is untrusted.
    for auth in email_message.get_all("Authentication-Results", []):
        a = " ".join(str(auth).lower().split())
        if not a.startswith("mx.google.com;"):
            continue
        if (re.search(r"\bdkim=pass\b[^;]*\bheader\.i=@yandex\.ru\b", a)
                and re.search(r"\bspf=pass\b[^;]*\bsmtp\.mailfrom=palleta\.store@yandex\.ru\b", a)
                and re.search(r"\bdmarc=pass\b[^;]*\bheader\.from=yandex\.ru\b", a)):
            return True
    return False


def extract_report(raw_encoded, internal_date_ms):
    raw = decode64(raw_encoded)
    check(len(raw) <= MAX_RAW, "raw MIME is too large")
    message = BytesParser(policy=policy.default).parsebytes(raw)
    check(parseaddr(str(message.get("From", "")))[1].lower() == EXPECTED_SENDER, "unexpected sender")
    check(str(message.get("Subject", "")).strip() == EXPECTED_SUBJECT, "unexpected subject")
    check(authenticated(message), "SPF/DKIM/DMARC authentication not verified")
    try:
        arrival = datetime.fromtimestamp(int(internal_date_ms) / 1000, tz=timezone.utc).astimezone(MSK)
    except (TypeError, ValueError, OverflowError) as e:
        raise SourceError("invalid Gmail internal timestamp") from e
    matches = []
    for part in message.walk():
        if part.is_multipart():
            continue
        name = part.get_filename()
        if not name:
            continue
        m = NAME.fullmatch(name)
        check(m is not None, "unexpected attachment filename")
        blob = part.get_payload(decode=True)
        check(isinstance(blob, bytes) and 0 < len(blob) <= MAX_XLS, "invalid XLS size")
        check(blob.startswith(bytes.fromhex("D0CF11E0A1B11AE1")), "expected binary XLS BIFF8/OLE")
        captured = datetime.strptime(m.group(1), "%Y-%m-%d %H-%M-%S").replace(tzinfo=MSK)
        check(abs((arrival - captured).total_seconds()) <= 120, "Gmail arrival and XLS timestamp differ")
        matches.append((name, blob, arrival.isoformat(timespec="seconds"), captured.isoformat(timespec="seconds")))
    check(len(matches) == 1, "expected exactly one named XLS attachment")
    return matches[0]


def gmail_json(method, url, access_token=None, body=None):
    headers = {"Accept": "application/json"}
    if access_token:
        headers["Authorization"] = "Bearer " + access_token
    if body is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        body = urlencode(body).encode("utf-8")
    req = Request(url, method=method, data=body, headers=headers)
    try:
        with urlopen(req, timeout=45) as response:
            payload = response.read(55_000_000)
        return json.loads(payload)
    except Exception as e:
        # Never include tokens, raw response content, or message in CI logs.
        raise SourceError("Gmail API/OAuth request failed (check OAuth secrets and access)") from e


def access_token():
    keys = ("GMAIL_OAUTH_CLIENT_ID", "GMAIL_OAUTH_CLIENT_SECRET", "GMAIL_OAUTH_REFRESH_TOKEN")
    values = [os.environ.get(k, "") for k in keys]
    check(all(values), "Gmail OAuth secrets not configured")
    response = gmail_json("POST", "https://oauth2.googleapis.com/token", body={
        "client_id": values[0], "client_secret": values[1],
        "refresh_token": values[2], "grant_type": "refresh_token",
    })
    token = response.get("access_token")
    check(isinstance(token, str) and bool(token), "OAuth refresh returned no access token")
    return token


def obtain_latest():
    token = access_token()
    query = 'from:palleta.store@yandex.ru subject:"Паллета 1С - Меню" has:attachment newer_than:2d -in:spam -in:trash'
    url = "https://gmail.googleapis.com/gmail/v1/users/me/messages?" + urlencode({"q": query, "maxResults": 3})
    listing = gmail_json("GET", url, access_token=token)
    check(isinstance(listing.get("messages", []), list), "unexpected Gmail list response")
    found = []
    for meta in listing.get("messages", []):
        ident = meta.get("id", "")
        check(bool(re.fullmatch("[a-zA-Z0-9]+", ident)), "invalid Gmail message id")
        detail = gmail_json("GET", f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{ident}?format=raw", access_token=token)
        check("raw" in detail and "internalDate" in detail, "Gmail RAW message incomplete")
        found.append((int(detail["internalDate"]), detail))
    if not found:
        return None
    found.sort(key=lambda item: item[0], reverse=True)
    newest = found[0][1]
    arrival = datetime.fromtimestamp(int(newest["internalDate"]) / 1000, tz=timezone.utc)
    if arrival < datetime.now(timezone.utc) - timedelta(hours=8):
        return None  # Never fall back to an old report.
    return extract_report(newest["raw"], newest["internalDate"])


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--output-dir", type=Path, required=True)
    ap.add_argument("--github-output", type=Path, required=True)
    args = ap.parse_args()
    try:
        report = obtain_latest()
        if report is None:
            print("NO_NEW_REPORT: no authenticated recent Gmail min-max XLS")
            with args.github_output.open("a", encoding="utf-8") as stream:
                stream.write("found=false\n")
            return 0
        filename, binary, arrival, captured = report
        args.output_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        dst = args.output_dir / filename
        with dst.open("xb") as f:
            os.chmod(dst, 0o600)
            f.write(binary)
        with args.github_output.open("a", encoding="utf-8") as stream:
            stream.write("found=true\n")
            stream.write("xls_path=" + str(dst) + "\n")
            stream.write("sent_at=" + arrival + "\n")
            stream.write("snapshot=" + captured + "\n")
        print("SOURCE_VERIFIED: authenticated Gmail RAW, dated binary XLS; private temp only")
        return 0
    except SourceError as exc:
        print("FAIL_CLOSED: " + str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
