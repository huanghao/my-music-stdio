// Tiny localStorage JSON helper shared by every prefs loader. Returns `fallback`
// when the key is missing, unparsable, falsy, or storage itself throws (private
// window, blocked site data). Callers still type-check each field they read.
function lsJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (_) { return fallback; }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { lsJson };
