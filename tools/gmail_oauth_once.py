#!/usr/bin/env python3
"""One-time LOCAL Gmail consent helper; never run in GitHub Actions."""
import argparse
import json
from pathlib import Path


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--client-json", type=Path, required=True, help="Desktop OAuth JSON outside the repo")
    args = ap.parse_args()
    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
    except ImportError as exc:
        raise SystemExit("Install locally: python -m pip install google-auth-oauthlib==1.2.2") from exc
    config = json.loads(args.client_json.read_text(encoding="utf-8"))
    client = config.get("installed")
    if not client or not client.get("client_id") or not client.get("client_secret"):
        raise SystemExit("Expected Google Desktop OAuth client JSON, not service-account credentials")
    flow = InstalledAppFlow.from_client_config(
        config, scopes=["https://www.googleapis.com/auth/gmail.readonly"]
    )
    creds = flow.run_local_server(host="localhost", port=0, access_type="offline", prompt="consent")
    if not creds.refresh_token:
        raise SystemExit("No offline refresh token returned. Check consent and login; STOP.")
    print("\nLOCAL SETUP ONLY. Store these as PRIVATE GitHub Actions repository secrets:")
    print("GMAIL_OAUTH_CLIENT_ID=" + client["client_id"])
    print("GMAIL_OAUTH_CLIENT_SECRET=" + client["client_secret"])
    print("GMAIL_OAUTH_REFRESH_TOKEN=" + creds.refresh_token)
    print("\nNever post these values in ChatGPT or any public repository file.")


if __name__ == "__main__":
    main()
