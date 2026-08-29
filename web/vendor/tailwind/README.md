# Vendored: @tailwindcss/browser

- **Package**: `@tailwindcss/browser`
- **Version**: 4.3.3
- **Source**: https://registry.npmjs.org/@tailwindcss/browser/-/browser-4.3.3.tgz (`dist/index.global.js`)
- **Vendored on**: 2026-08-29
- **Why**: the project has no build step — the browser build compiles `text/tailwindcss` style blocks and watches class attributes via MutationObserver at runtime, so Tailwind works as a plain `<script>` like the other vendored libs (marked, svguitar, pdfjs).
- **Upgrade**: download the new version's `dist/index.global.js` from the npm registry tarball and replace `browser.js`, then update this README.
