# V1 retirement checklist — after approved cutover

No component in this list was deleted during V2 development. The obsolete RPC execution grants were revoked as the explicitly requested security repair; its function body is still present.

- [ ] Confirm no workstation/phone or ChatGPT project still calls `push-note`, `relay-api`, `work-relay`, `assistant-feed`, Netlify `/push` or `/latest`.
- [ ] Rotate/retire the legacy hardcoded/reused credential. It was not copied into V2 source, documentation or environment.
- [ ] Remove obsolete Edge Functions `push-note`, `relay-api`, `work-relay`, `assistant-feed`, `relay-ui`, `relay-ui-test`, `publish-relay-ui`, once each caller is migrated.
- [ ] Delete `relay_set_note(text)` after confirming no service-role legacy caller needs it. Never regrant it to PUBLIC, anon or authenticated.
- [ ] Remove existing temporary V1 plaintext note from `relay_state`, delete files via Storage API, then remove `relay_state`, `relay_files`, `relay_config` only after the rollback window.
- [ ] Remove empty `relay-files` and unused public HTML buckets `relay-web` / `relay-ui-public`.
- [ ] Remove V1 Netlify Blob content and old Netlify functions after confirming their owner/runtime. Do not archive relay contents.
- [ ] Remove duplicate repository HTML files and the obsolete GitHub relay file `relay/latest.json`. Audit historical GitHub content separately; deleting the working-tree file does not remove history, forks, cached copies or previously published ciphertext. History rewriting needs a separate coordinated decision.
- [ ] Reconcile old migrations via a reviewed baseline; do not delete applied migration history arbitrarily. Historical seed migrations may contain patient/demo content; do not export them into GitHub.
- [ ] Remove stale V1 localStorage credential keys when decommissioning legacy browser use; do not disrupt open V1 sessions during the preview period.
- [ ] Rerun security advisors and inspect all public function grants, storage policies, public buckets, active Edge endpoints and Netlify functions for equivalent bypasses.
- [ ] Confirm only the intended V2 origin and sender can access V2; remove preview invitations, device sessions and test-only credentials.

Cleanup is a separate production change with its own review and owner approval. Preserve rollback code/deploy metadata, never patient-content backups.
