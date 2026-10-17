# Gmail → 1C XLS → guarded PR (v1.6)

## State
Prepared, NOT ACTIVE until read-only Gmail OAuth secrets are configured and an end-to-end scheduled run passes. This workflow deliberately never merges PRs or publishes site without release QA.

## One-time authorization
1. In Google Cloud Console enable Gmail API, configure OAuth consent screen and create Desktop OAuth client. Testing-mode refresh tokens may expire after 7 days.
2. Authorize mailbox owner with scope https://www.googleapis.com/auth/gmail.readonly, offline access and consent; obtain refresh token securely. ChatGPT Gmail authorization cannot be reused by GitHub Actions.
3. Create 3 GitHub Actions repository secrets at https://github.com/shmlr/palleta-menu/settings/secrets/actions : GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET, GMAIL_OAUTH_REFRESH_TOKEN. Never share values in chat or repo.
4. Allow GitHub Actions to create pull requests, and protect main.
5. Merge integration PR only after CI passes. The workflow polls at 19:15, 20:15, 21:15, 22:15, 23:15 Moscow time. GitHub schedule may be delayed; eight-hour stale-data rejection remains enforced.
6. After new evening report, trigger workflow manually and confirm real Gmail import, an automated PR with ONLY products.json diff, PR CI PASS, then review/merge and check live Pages.

## Safety
Exact sender/subject, Gmail authentication result, one dated XLS, BIFF OLE bytes, 25MB maximum, sheet/headers/footer, report timestamp, latest snapshot, paired identity and approved kg unit, price-change guard, only allowlisted prices. Any error STOP. XLS is deleted from private runner temp directory, never committed or uploaded as artifact. Availability remains UNKNOWN. This workflow does NOT auto-merge or auto-publish.

Only potato УТ-00003202|3202 is currently approved. Herbs, meat, and the remaining six weight items are still blocked.

Google OAuth setup and GitHub secret creation need mailbox owner's one-time action; connected ChatGPT Gmail grant is not exportable.