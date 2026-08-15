// Not part of pdf.js — my-music-stdio's own integration script, loaded by our
// modified viewer.html (see the <script> tag added near the bottom of body).
//
// Stock pdf.js only knows how to hand annotated PDF bytes to the browser's
// download manager (Save button → local file download). We want the opposite:
// bake the user's draw/highlight/etc. annotations into the PDF bytes and PUT
// them straight back to the materials library, so the same URL that's already
// embedded in a Lick's notes now serves the annotated file — no re-upload,
// no re-linking. See PDFViewerApplication.save()/downloadOrSave() in
// viewer.mjs: both paths funnel through `this.downloadManager.download(data,
// url, filename)`, so overriding that one method covers Ctrl+S, the toolbar
// Save button, and the secondary-toolbar entry alike.
//
// Only active when the embedding page passes `?saveMaterialId=<id>` — PDFs
// that aren't in our materials library (or opened standalone) fall back to
// pdf.js's normal "download to disk" behavior untouched.

// pdf.js remembers the last-viewed page/scroll/zoom per PDF (ViewHistory,
// keyed by the file's content fingerprint) in localStorage — shared across
// *every* same-origin iframe showing that file, not just tabs. That's
// invisible with one viewer open, but it means our own #page=N in the src
// URL gets silently overridden by whatever page some OTHER iframe of the
// same file last landed on — exactly what happens with a dual-page view's
// two panes, which are two iframes of the identical file by construction.
// AppOptions.set is synchronous and runs here before webViewerLoad's own
// DOMContentLoaded-time setup reads it, so this reliably wins for every
// embed (single or dual) — #page=N in the URL is always authoritative,
// never silently resumed from a stale shared position.
window.PDFViewerApplicationOptions?.set('viewOnLoad', 1); // ViewOnLoad.INITIAL (see viewer.mjs)

const materialId = new URLSearchParams(location.search).get('saveMaterialId');
if (materialId) {
  window.addEventListener('load', async () => {
    const app = window.PDFViewerApplication;
    await app.initializedPromise;

    app.downloadManager.download = async (data) => {
      if (!data) return; // pdf.js couldn't produce bytes — nothing to save
      // PDFViewerApplication.save() (viewer.mjs) calls
      // `this.downloadManager.download(data, ...)` WITHOUT awaiting it — the
      // toolbar's "wait" cursor clears and the click looks finished the
      // instant this function *starts*, not when the upload actually lands.
      // Reloading in that gap can cancel the in-flight PUT, so the server
      // never gets the annotated bytes and the reload shows the stale file —
      // this banner is the only signal a user has for when it's actually
      // safe to leave, so it must stay up for the whole request, not fade
      // like a normal toast.
      showBanner('正在保存标注到服务器…');
      try {
        const formData = new FormData();
        formData.append('file', new Blob([data], { type: 'application/pdf' }), 'annotated.pdf');
        const res = await fetch(`/api/materials/${encodeURIComponent(materialId)}/content`, {
          method: 'PUT',
          body: formData,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        showBanner('已保存标注，可以安全刷新/离开', { autoHideMs: 2500 });
        // Any other iframe showing this same file (a dual-page-view companion,
        // or just another independent embed of it elsewhere in the note) now
        // has stale bytes in memory — same-origin, so a direct call up through
        // the embedding page beats round-tripping postMessage. Optional
        // chaining: a no-op when opened standalone (no such parent function).
        window.parent.licksNotifyPdfSaved?.(`/api/materials/${materialId}`, window);
      } catch (e) {
        console.error('Failed to save annotated PDF back to materials library:', e);
        showBanner('保存标注失败，请勿刷新，重新点击保存：' + e.message, { isError: true });
      }
    };
  });
}

// Read-only mode (?readonly=1): the passive companion pane of a dual-page
// view (see licksSetupDualPdfSync in licks.js) — a view-only mirror of
// whatever page the editable primary pane is on. Disables annotation editing
// at the pdfViewer level, not just the toolbar buttons — AnnotationEditorType
// .DISABLE blocks every entry point (keyboard shortcuts included), and the
// buttons are hidden too so nothing on screen invites a click that won't do
// anything.
if (new URLSearchParams(location.search).get('readonly') === '1') {
  window.addEventListener('load', async () => {
    const app = window.PDFViewerApplication;
    await app.initializedPromise;
    const DISABLE = window.pdfjsLib?.AnnotationEditorType?.DISABLE ?? -1;
    try { app.pdfViewer.annotationEditorMode = { mode: DISABLE }; } catch (_) { /* no document yet, or already disabled */ }
    const style = document.createElement('style');
    style.textContent = '#editorModeButtons, #editorModeSeparator { display: none !important; }';
    document.head.appendChild(style);
  });
}

// A fixed banner (not a corner toast) so it can't be missed or scrolled past.
// Reused across calls — one element updated in place, so a fast save→save
// doesn't stack duplicates.
let bannerEl = null;
function showBanner(text, { isError = false, autoHideMs = null } = {}) {
  if (!bannerEl) {
    bannerEl = document.createElement('div');
    bannerEl.style.cssText = `position:fixed;top:0;left:0;right:0;padding:8px 16px;` +
      `font-size:13px;text-align:center;z-index:99999;box-shadow:0 2px 8px rgba(0,0,0,.3);`;
    document.body.appendChild(bannerEl);
  }
  bannerEl.textContent = text;
  bannerEl.style.background = isError ? '#c0392b' : '#2d2d2d';
  bannerEl.style.color = '#fff';
  bannerEl.style.display = 'block';
  clearTimeout(bannerEl._hideTimer);
  if (autoHideMs) {
    bannerEl._hideTimer = setTimeout(() => { bannerEl.style.display = 'none'; }, autoHideMs);
  }
}
