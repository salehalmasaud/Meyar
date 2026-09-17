# Trackcare ChatGPT Project Instructions

Keep the current production project's working sender unchanged during V2 review. Use a separate test conversation/project or a sender explicitly configured for the preview. Do not put encryption/signing keys, service-role credentials, device invitations or PIN-derived crypto in Project Instructions, chat messages, repository files or generated links in the conversation.

## Pasteable behavior instructions

```text
Trackcare Relay is my temporary bridge to my hospital workstation.

When I say “ارسلها للدوام”, send the latest FINAL Dietitian Note from this conversation through the configured Trackcare Relay sender. Do not ask me to copy the note, open a transfer page, refresh the workstation or manually move a file.

Send the complete final note exactly as written. Preserve every space, blank line, line break, Unicode character and bullet. Do not add a greeting, explanation, Markdown fence, timestamp or clinical change to the transmitted note. If there is no identifiable final note, ask which note to send; never invent patient content.

Use only the configured authenticated sender. It reads independent encryption and HMAC credentials from its protected runtime environment. The visible access code 000 is never a sender credential or encryption key. Never print, request in chat or reveal secrets.

Use the V2 encrypted POST transport when that environment has been configured and approved. The sender generates a fresh timestamp, nonce, IV and monotonic version; encrypts with AES-256-GCM; signs the canonical envelope; and sends it. Use encrypted GET only if the configured sender explicitly requires it and the entire encrypted URL fits its limit. Never place plaintext patient text in a URL or search query. Never write a note to GitHub or a permanent document store.

Confirm “تم إرسال الملاحظة للدوام.” only after the sender reports successful HTTP acceptance with the submitted version. The workstation updates automatically. Do not claim that Copy/pasting into the hospital system has happened.

If the send fails, report “تعذر الإرسال؛ الملاحظة لم تُؤكد في Relay.” Do not silently switch destinations or expose errors/keys. A timeout is uncertain, not proof of failure. Retry the same envelope once: 409 may mean it already arrived or a newer note exists. Verify using the sender's available acknowledgement method; never overwrite a potentially newer note with a regenerated version merely to force success. If no sender tool/runtime is available, say the integration is not connected. Instructions alone do not make an unavailable tool callable.

Do not clear the relay automatically after sending. On the workstation I choose Copy, Copy & Clear, or Clear. Relay content is temporary and contains only the latest note.
```

## V2 sender contract

Reference implementation: `v2/scripts/push-note.ts` and `v2/server/core.ts`. The sender requires environment variables `RELAY_EDGE_URL`, `RELAY_ENCRYPTION_SECRET` and `RELAY_PUSH_HMAC_SECRET` in its execution environment. Input is exact UTF-8 on stdin; no patient text is accepted in shell command arguments or printed. The script emits only success or a generic HTTP failure.

- POST `https://gvuuiazenabtsbmozrbk.supabase.co/functions/v1/relay-v2/push`
- JSON: `protocol:2`, `version` (safe integer, current epoch milliseconds), `timestamp` (epoch milliseconds), `nonce` (24 random bytes base64url), `iv` (12 random bytes base64url), `ciphertext` (AES-GCM ciphertext plus 16-byte tag, base64url), `signature` (32-byte HMAC, base64url).
- AES additional authenticated data: `relay-v2\n{version}\n{timestamp}\n{nonce}`.
- HMAC message: additional authenticated data + `\n{iv}\n{ciphertext}`. All encoding is UTF-8, unpadded canonical base64url.
- GET alternative: `/push?envelope={base64url(UTF8(JSON))}`; no other query fields. V1 `v/s/i/d/sig` requests continue to their unchanged V1 endpoint; they are deliberately not interpreted under the stronger V2 keys.
- Text expiry: 30 minutes after acceptance; the sender does not choose retention.

## Actual ChatGPT hookup still requires validation

The existing ChatGPT project's tool configuration and protected runtime were not available to edit from this repository task. The V2 sender is implemented and exercised against the preview, but **the phrase-to-tool invocation on the owner's phone has not been demonstrated**. Do not replace the working project's credentials/instructions until its preview sender can securely receive the new environment secrets and successfully send a synthetic note.

Project instructions are behavior guidance, not a secret store or a tool installation. Official OpenAI documentation describes separately connecting and testing an MCP/plugin tool, with availability controlled by account/workspace policy: [Connect and test your plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt). This delivery does not claim that a custom MCP tool was installed in the owner's phone ChatGPT account. If the current sender cannot use protected environment credentials, choose an authenticated connector integration before cutover; do not solve it by pasting cryptographic secrets into instructions.
