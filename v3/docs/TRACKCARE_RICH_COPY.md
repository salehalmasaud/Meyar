# TrackCare rich copy

Relay keeps the stored note as exact plain UTF-8 text. Rich formatting is created only at copy time, so the source note remains unchanged and the clipboard always includes an exact text/plain fallback.

The TrackCare HTML clipboard style is based on the approved Example Note.docx:

- Title and section headings: Times New Roman, 13.5 pt, bold, underlined, #006666.
- Title and Plan heading: #ECF0F1 background highlight.
- Pt / Dx lines: Times New Roman, 13.5 pt, bold.
- Nutrition Assessment body: Cambria, 10 pt, bold.
- Anthropometrics and Laboratory body: Times New Roman, 12 pt, regular.
- Nutrition Requirements and Plan body: Times New Roman, 12 pt, bold.
- Hyphen/round bullets in the source note are rendered as round bullets in rich HTML.
- Clipboard payload contains both text/html and exact text/plain. If rich clipboard APIs are unavailable, Relay falls back to the exact plain note.

No font files are bundled. The workstation uses locally installed Times New Roman and Cambria.

Deployment boundary: the V3 receiver is a Netlify branch alias. Frontend changes must be deployed to the existing trackcare-relay-v3 alias only; never publish this branch as the production site.
