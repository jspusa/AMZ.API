# Vendored cross-platform spellchecker

These shared assets run only inside the trusted Notebook Key main process to
build the content-audit snapshot. The renderer receives the resulting issues
and lightweight version metadata; it does not execute a second spellcheck.

- `nspell-2.1.5.js`: browser ESM bundle of
  [`nspell@2.1.5`](https://www.npmjs.com/package/nspell/v/2.1.5) and its
  `is-buffer@2.0.5` dependency. Generated with the repository's pinned
  `esbuild`; SHA-256
  `8194144b0fc8754e257332be6d6565e70aa60adbeccdc61abafadfa949eb4269`.
- `en_US.aff` and `en_US.dic`:
  [`dictionary-en@4.0.0`](https://www.npmjs.com/package/dictionary-en/v/4.0.0)
  (SCOWL en_US
  2020.12.07). SHA-256 values are
  `8ae1f19d4840d957728ad90555d5a8dff6cc5c046279c95ff0c00fc0a0136c7b`
  and `f0b1a234bd178bdd01875b2a392a9647f888b8fe879f79c52aae62c2759b3647`.

The complete upstream notices are preserved in
`src/renderer/public/licenses/spellcheck/`; Vite copies that directory into
the Pages artifact and packaged Notebook Key output. Update the version,
hashes, assets, notices, metadata, and spelling regressions together.
