# Vendored pdf.js (v6.2.108, "generic" prebuilt release)

Source: https://github.com/mozilla/pdf.js/releases/download/v6.2.108/pdfjs-6.2.108-dist.zip

Trimmed from the official dist zip to keep this small: source maps dropped,
and `web/locale/` kept to only `en-US` + `zh-CN` (pdf.js falls back to
`en-US` for any other browser locale — a few strings won't localize, nothing
breaks).

## Local modification

`web/viewer.html` has one added line near the end of `<body>`:

```html
<script src="../save-hook.js" type="module"></script>
```

`save-hook.js` (ours, not upstream) is what makes the built-in draw/
highlight/etc. annotations actually persist: it overrides
`PDFViewerApplication.downloadManager.download()` so the toolbar's Save
button PUTs the annotated PDF bytes back to `/api/materials/{id}/content`
instead of triggering a local file download. See that file's header comment
for the mechanism.

## Upgrading

Re-download a newer `pdfjs-<version>-dist.zip`, redo the same trim (drop
`.map` files, keep only `en-US`/`zh-CN` under `web/locale/`), then reapply
the one-line `<script>` addition to the new `viewer.html` before `</body>`.
