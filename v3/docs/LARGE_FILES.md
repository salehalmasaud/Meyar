# Relay V3 large-file transfer

## Purpose
The hospital workstation cannot open Google Drive. Large files must be uploaded and later downloaded entirely through the existing private Relay V3 site. Google Drive is not part of this transfer.

## Design
- Supported sizes: 1 byte through 100 MiB. The original encrypted small-file path remains unchanged for PDF/image files up to 20 MiB.
- New formats: ZIP, DOCX, XLSX, PPTX, MP4, MOV. Images and PDF over 20 MiB also use the chunked path.
- Each upload is split into 4 MiB parts, independently encrypted with the existing server-side AES-256-GCM key and part-specific additional authenticated data.
- No plaintext binary content, keys, or original filenames are persisted in the browser. The filename remains encrypted server-side.
- Chunk requests go directly to the existing Supabase Edge Function, using a session-bound, HMAC-signed, 45-minute upload ticket. No Netlify buffered file proxy.
- New RPCs reserve bounded capacity, record cryptographic chunk digests and enforce complete file transfer before marking a file ready.
- Uploaded files appear in the existing authenticated Relay file list. The large-file Download action acquires a short-lived signed ticket via the same-origin authenticated gateway, then downloads/decrypts each chunk and reconstructs one file in browser memory.
- Large-file previews and direct in-chat MCP attachments are intentionally unsupported; use Download on a laptop.
- Files retain the existing V3 24-hour TTL (configurable) and are physically deleted by the existing expiry sweep. The Store deletion path now also removes encrypted chunks.
- Notes, sender permissions, PIN, existing private bookmark, V1 and V2 are unchanged.

## Limits and operational notes
- 100 MiB per file, 400 MiB total active/pending encrypted file capacity, 100 file records.
- A pending large upload expires after 90 minutes. File upload tickets expire after 45 minutes. The original unlocked viewer session must remain active.
- The file download ticket lasts at most 20 minutes and never longer than the file TTL. A fresh ticket can be issued for each download.
- Chunk transfer retrying is automatic (up to three attempts). A failed file can be retried from the UI as a new upload after correcting the issue; unfinished partial data expires.
- Only allow-listed non-executable file types are accepted. Each file's first chunk is validated against the expected format.
- Do not upload patient-identifiable records to personally hosted systems unless approved by the relevant organization.

## Verification
1. Apply the additive SQL migration before deploying the Edge Function.
2. Deploy only relay-v3 (maintain verify_jwt=false because existing custom gateway/token authentication is used).
3. Deploy only the V3 Netlify preview alias, never production V1.
4. Run TypeScript, unit tests, browser UI tests and a synthetic >20 MiB end-to-end upload/download with a byte-for-byte SHA-256 comparison.
5. Confirm normal note sender, small-file upload, file expiry and deletion continue working.
