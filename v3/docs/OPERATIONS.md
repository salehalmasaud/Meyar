# Provisioning, migration and rollback

## Provisioning completed

- Branch: `trackcare-relay-v3`; isolated checkout: `C:\trackcare-relay-v3`.
- Preview only: `https://trackcare-relay-v3--trackcare-relay.netlify.app`.
- One stable receiver URL: `%LOCALAPPDATA%\TrackcareRelay\v3\receiver-url.txt`. This is a private receiver bookmark, not a device invitation. Copy/bookmark the exact URL from that file, including its `#access=` fragment. Open it and enter `000`.
- One public transport endpoint: `https://trackcare-relay-v3--trackcare-relay.netlify.app/push-note-v3`, authenticated by the encrypted envelope. The user never opens this manually.
- Private ChatGPT app: **Trackcare Relay V3**, connected with OAuth to `https://trackcare-relay-v3--trackcare-relay.netlify.app/mcp`. Only `send_note({note})` is exposed. The actual Trackcare Project Instructions have been updated while preserving clinical instructions.
- Independent backend: `relay-v3`, `relay_v3_*`, `relay-v3-private`, `relay-v3-expiry-sweep`.
- Sender migration: `20260920103000_relay_v3_sender.sql`, five additive tables and `relay-v3-sender-expiry`. No note data migration or new wire protocol.
- V3 private environment outside Git: `%LOCALAPPDATA%\TrackcareRelay\v3\.env`. Windows ACL restricts this directory to the owner and SYSTEM. No encryption/signing keys belong in Project Instructions.

`scripts/provision-secrets.ps1` refuses to rotate an existing secret file. Run only once. `scripts/deploy-preview.ps1` requires the exact V3 branch and always deploys to the V3 alias without `--prod`; it injects only the gateway secret and public routing configuration into that specific deploy. It does not edit site-wide V1/V2 environment variables.

Supabase secrets use only `RELAY_V3_*` names. Deploy only `relay-v3` with `--use-api --no-verify-jwt`; do not deploy all functions or use `--prune`. Disabling platform JWT verification is intentional: sensitive routes implement custom authentication before access.

## Configuration

- Notes: fixed twelve-hour TTL in the append transaction.
- Files: `RELAY_V3_FILE_TTL_SECONDS=86400`; changing it affects new uploads only, with a 60–604800 second supported range.
- Viewer session: `RELAY_V3_SESSION_TTL_SECONDS=28800`; bounded to at most twelve hours.
- Encrypted GET compatibility: `RELAY_V3_ALLOW_GET_PUSH=true`; retained for compatibility. The new ChatGPT app always sends via POST. Retiring legacy GET is a separate operational change.
- File signed links: 60 seconds maximum.
- OAuth: two-minute authorization code, one-hour access token, rotating refresh token valid for 30 days unused; fixed `notes.write` scope. No sender secret is copied into ChatGPT instructions or a URL.

## Migration plan

1. Keep V1 production and V2 preview running as they are. There is no automatic data migration or copy of old clinical content.
2. The user has already confirmed the existing V3 receiver works at the hospital. The sender/polish update retains its stable URL, PIN and temporary inbox model.
3. The protected sender and real ChatGPT OAuth app are deployed. The actual Trackcare project uses the V3 instructions. See the ChatGPT acceptance evidence; normal sends do not deploy or write to GitHub.
4. Verify the connected tool on the physical phone and the updated Copy/file UI on the hospital workstation. Web account acceptance does not prove native mobile availability.
5. No Netlify production URL or V1/V2 deployment was changed. Any future production switch needs explicit owner approval.

## Rollback plan

Rollback point before this update: tag `trackcare-relay-v3-before-sender-polish-20260920`, commit `8ab0b62`. Prior V3 preview deploy: `6aaf8e9d563b51059b213f23`. Current preview deploy: `6aaf9fe75671610bc8dbdc44`. V1 production remains deployment `6aaa498ed4d229964811995b`; never publish a V3 deploy as production or rebuild V1 from the repository root as a substitute for that known deploy.

For a V3 UI regression, deploy the prior commit from an isolated checkout to the same V3 alias, without `--prod`. Keep all existing V3 secrets so the hospital bookmark continues working. For a sender/backend regression, disconnect the ChatGPT app, redeploy only the prior `relay-v3` function and V3 preview, and clearly mark sending unavailable in Project Instructions. Do not silently route clinical notes to V1/V2. Additive schema objects can remain; leave cleanup schedules running. No database restore or patient-content migration is required.

For suspected V3 viewer-link disclosure, rotate only the V3 viewer secret, revoke all V3 session rows, and distribute the new private receiver bookmark. That is an exceptional security rotation, not enrollment. Sender key rotation is separate. Never rotate V1/V2 keys as part of V3 recovery.

If V3 is abandoned, allow existing content to expire while the scheduler remains active. Verify zero V3 note/file Storage objects before removing V3-only infrastructure. Do not disable cleanup while temporary content remains. Do not drop tables/buckets or delete any V1/V2 resources without separate authorization.

## Evidence boundaries

Automated live tests demonstrate deployed endpoints, browser rendering, clipboard arguments, cleanup and security isolation. Actual ChatGPT web conversations additionally verify phrase-based tool selection and receipt handling. Native phone availability and paste into the hospital system still require physical testing. Twelve-hour deadlines are checked in actual database records; accelerated synthetic expiry tests cleanup without claiming twelve elapsed hours.

## Future production cutover checklist

1. Confirm `ارسلها للدوام` invokes the connected tool from a new Trackcare conversation on the real phone; complete any ChatGPT-controlled write confirmation.
2. Open the existing private bookmark at the hospital, enter 000, copy two accumulated notes in sequence and verify the hospital system receives the intended text. Check screenshot paste and required file formats there.
3. Review the deployed SHA, security report, independent expiry and rollback tag. Confirm no clinical content remains in test fixtures or browser persistence.
4. Obtain explicit approval for the exact production hostname/deployment change. No production switch is authorized by this preview task.
5. Preserve the known V1 deployment and V2 preview for rollback; do not drop legacy infrastructure during cutover. Retain V3 cleanup throughout.
