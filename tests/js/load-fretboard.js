// Loads the 12 fretboard modules (split out of web/fretboard.js) in the same
// order index.html loads them, mirroring the browser's shared global scope.
// Must require + assign one file at a time: fb-init.js's guarded() wrappers
// run at require time and read the drill functions (fbBendNext etc.) off
// `global`, so each module's exports must be on `global` before the next
// one is required.
const FILES = [
  'fb-core', 'fb-prefs', 'fb-board', 'fb-audio', 'fb-ear', 'fb-seq',
  'fb-iv', 'fb-pitch', 'fb-tuner', 'fb-chord', 'fb-bend', 'fb-init',
];

const merged = {};
for (const f of FILES) {
  const m = require(`../../web/${f}.js`);
  Object.assign(global, m);
  Object.assign(merged, m);
}
module.exports = merged;
