// ── Materials library management (Preferences page) ──
// The materials library (src/materials_store.py, /api/materials) has had
// upload/list/delete/state endpoints for a while, but no UI ever exposed
// delete or rename, and uploads never deduped — every upload writes a brand
// new file, even a byte-identical re-upload of something already there.
// This is the first UI for actually managing what's in there: rename,
// delete (guarded by a usage check), and a duplicate-content hint.
//
// "Usage" is a best-effort scan, not a structured reference index: a
// material with a non-empty `state` blob IS a Song Loop track (that's what
// writes state, so its presence already means "in use"); beyond that, a
// Lick can only reference a material by embedding its URL as plain text
// inside the Lick's Markdown notes, so the only way to find that is a
// substring search across every Lick's notes. No false negatives for exact
// URL matches, but there's no way to catch e.g. a URL copied elsewhere
// outside this app.

let mtState = { materials: [], licks: [], loaded: false };

async function mtLoad() {
  const [materials, licks] = await Promise.all([
    api('/api/materials'),
    api('/api/licks'),
  ]);
  mtState.materials = materials;
  mtState.licks = licks;
  mtState.loaded = true;
}

function mtUsageFor(material) {
  const usedBy = [];
  if (material.state && Object.keys(material.state).length) usedBy.push('Song Loop 练习记录');
  mtState.licks.forEach((l) => {
    if (typeof l.notes === 'string' && l.notes.includes(material.url)) usedBy.push(`Lick「${l.title}」`);
  });
  return usedBy;
}

function mtFmtSize(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

function mtIconFor(material) {
  if (/\.pdf(?:$|[?#])/i.test(material.url)) return '📄';
  if (/\.(mp3|wav|m4a|ogg|flac)(?:$|[?#])/i.test(material.url)) return '🎧';
  return '📎';
}

// Materials whose content_hash matches at least one other material —
// grouped purely for the UI badge, doesn't change any behavior.
function mtDuplicateIds() {
  const byHash = new Map();
  mtState.materials.forEach((m) => {
    if (!m.content_hash) return;
    const arr = byHash.get(m.content_hash) || [];
    arr.push(m);
    byHash.set(m.content_hash, arr);
  });
  const dupIds = new Set();
  byHash.forEach((arr) => { if (arr.length > 1) arr.forEach((m) => dupIds.add(m.id)); });
  return dupIds;
}

function mtRenderRow(m, dupIds) {
  const usage = mtUsageFor(m);
  const usageHtml = usage.length
    ? usage.map((u) => `<span class="mt-usage-tag">${htmlEsc(u)}</span>`).join('')
    : `<span class="mt-usage-tag mt-usage-none">⚠ 未被引用</span>`;
  const dupBadge = dupIds.has(m.id)
    ? `<span class="mt-dup-badge" title="内容和其它素材完全一致（SHA-256 相同）">重复内容</span>` : '';
  return `
    <div class="mt-row" data-id="${m.id}">
      <div class="mt-icon">${mtIconFor(m)}</div>
      <div class="mt-name" id="mt-name-${m.id}">
        <span class="mt-name-text">${htmlEsc(m.filename)}</span>${dupBadge}
      </div>
      <div class="mt-meta">${mtFmtSize(m.size)} · ${htmlEsc((m.uploaded_at || '').slice(0, 10))}</div>
      <div class="mt-usage">${usageHtml}</div>
      <div class="mt-actions">
        <button type="button" class="btn btn-ghost btn-sm" onclick="mtStartRename('${m.id}')">改名</button>
        <button type="button" class="btn btn-ghost btn-sm danger" onclick="mtDelete('${m.id}')">删除</button>
      </div>
    </div>`;
}

function mtRender() {
  const el = document.getElementById('mt-list');
  if (!el) return;
  if (!mtState.materials.length) {
    el.innerHTML = '<p class="empty-state">资料库是空的。</p>';
    return;
  }
  const dupIds = mtDuplicateIds();
  el.innerHTML = mtState.materials.map((m) => mtRenderRow(m, dupIds)).join('');
}

async function initMaterialsPrefsSection() {
  const el = document.getElementById('materials-prefs');
  if (!el) return;
  el.innerHTML = '<p class="empty-state">Loading…</p>';
  try {
    await mtLoad();
    const totalSize = mtState.materials.reduce((s, m) => s + m.size, 0);
    el.innerHTML = `
      <h3 class="fb-sound-vol-title">素材库管理 · Materials</h3>
      <p class="fb-sound-vol-desc">共 ${mtState.materials.length} 个文件 · ${mtFmtSize(totalSize)}
        · "未被引用"是尽力扫描的结果（对比每个 Lick 笔记里的链接文本），不保证 100% 准确</p>
      <div id="mt-list" class="mt-list"></div>
    `;
    mtRender();
  } catch (e) {
    el.innerHTML = `<p class="empty-state">加载失败：${htmlEsc(e.message)}</p>`;
  }
}

function mtStartRename(id) {
  const m = mtState.materials.find((x) => x.id === id);
  const cell = document.getElementById(`mt-name-${id}`);
  if (!m || !cell) return;
  cell.innerHTML = `<input type="text" class="mt-rename-input" id="mt-rename-input-${id}" value="${htmlEsc(m.filename)}">`;
  const input = document.getElementById(`mt-rename-input-${id}`);
  input.focus();
  input.select();
  let committed = false;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { committed = true; mtCommitRename(id, input.value); }
    else if (e.key === 'Escape') { committed = true; mtRender(); }
  });
  input.addEventListener('blur', () => { if (!committed) mtRender(); });
}

async function mtCommitRename(id, newName) {
  const name = newName.trim();
  if (!name) { mtRender(); return; }
  try {
    await api(`/api/materials/${id}/filename`, 'PUT', { filename: name });
    const m = mtState.materials.find((x) => x.id === id);
    if (m) m.filename = name;
    mtRender();
    setStatus('已改名');
  } catch (e) {
    setStatus('改名失败：' + e.message);
    mtRender();
  }
}

// ── Shared upload-dedup check ────────────────────────────────────────────
// Used by both upload flows that hand a fresh local file to the materials
// library (licks.js materialUploadAndInsert, song-loop.js
// registerAsLibraryMaterial) — computes the file's SHA-256 via the browser's
// built-in Web Crypto API (no library needed) and checks it against
// /api/materials/by-hash *before* uploading, so a byte-identical re-upload
// can be caught before spending the bandwidth to send it again.
async function mtSha256Hex(file) {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Returns the existing material's {id, filename, url, ...} if the user
// chose to reuse it, or null if there was no match, hashing/lookup failed,
// or the user chose to upload a new copy anyway — callers should proceed
// with their normal upload POST in the null case.
async function mtCheckDuplicateBeforeUpload(file) {
  let hash;
  try {
    hash = await mtSha256Hex(file);
  } catch (_) {
    return null; // Web Crypto unavailable (e.g. non-HTTPS context) — just upload normally
  }
  let existing;
  try {
    existing = await api(`/api/materials/by-hash/${hash}`);
  } catch (_) {
    return null; // 404 (no match) or network hiccup — either way, proceed with a normal upload
  }
  const useExisting = confirm(
    `内容和已有素材完全一致："${existing.filename}"（${mtFmtSize(existing.size)}，上传于 ${(existing.uploaded_at || '').slice(0, 10)}）。\n\n` +
    `点"确定"使用已有的（不重复占用空间），点"取消"仍然新建一份。`
  );
  return useExisting ? existing : null;
}

async function mtDelete(id) {
  const m = mtState.materials.find((x) => x.id === id);
  if (!m) return;
  const usage = mtUsageFor(m);
  const warn = usage.length
    ? `\n\n注意：这个文件目前仍被引用：${usage.join('、')}\n删除后这些地方的链接会失效（PDF/音频预览会打不开）。`
    : '';
  if (!confirm(`删除素材"${m.filename}"？${warn}`)) return;
  try {
    await api(`/api/materials/${id}`, 'DELETE');
    mtState.materials = mtState.materials.filter((x) => x.id !== id);
    mtRender();
    setStatus('已删除');
  } catch (e) {
    setStatus('删除失败：' + e.message);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    mtState, mtLoad, mtUsageFor, mtFmtSize, mtIconFor, mtDuplicateIds,
    initMaterialsPrefsSection, mtCommitRename, mtDelete,
    mtSha256Hex, mtCheckDuplicateBeforeUpload,
  };
}
