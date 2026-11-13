# Contributing to env-saaf

Thanks for stopping by! env-saaf is a small, zero-dependency package, and contributions of every size are welcome — a typo fix counts just as much as a new feature.

## Ground rules

- **Zero dependencies, forever.** The whole point of this package is that it adds nothing to your `node_modules`. PRs that add a runtime dependency will be closed (politely).
- **Node >= 16.** Code must run on Node 16 and newer. Plain JavaScript, CommonJS entry (`index.js`), TypeScript types in `index.d.ts`.
- **Tests must pass, and new behaviour needs a test.** We use the built-in `node:assert` style in `test.js` — no test framework to learn.

## Getting started

```bash
git clone https://github.com/abhi478jeetur-rgb/env-saaf.git
cd env-saaf
npm test        # runs the full test file, no install step needed
```

## Picking something to work on

- Issues labelled **`good first issue`** are small, self-contained and a great place to start.
- Issues labelled **`help wanted`** are things the maintainer actively wants help with.
- If you want to work on something bigger, please open an issue first and say so — that way nobody builds the same thing twice.

## Making a change

1. Fork the repo and create a branch: `git checkout -b fix/short-name`
2. Make your change in `index.js` (and `cli.js` / `index.d.ts` if they are affected).
3. Add or update tests in `test.js`.
4. Add a line about your change under `## Unreleased` in `CHANGELOG.md`.
5. Run `npm test` and make sure it passes.
6. Open a Pull Request and fill in the template. Link the issue it fixes (`Fixes #123`).

## How releases work here (please read before asking for a version bump)

Releases are deliberately slow. Fixes and improvements collect under `## Unreleased` in the changelog. Only when **10–15 improvements** have collected do we cut a new version (for example `1.1.0`) and publish it to npm. This keeps every release meaningful and avoids version-number noise — so please do not bump `version` in `package.json` in your PR.

## Reporting bugs and asking for features

Use the issue templates. A good bug report includes: what you expected, what actually happened, a tiny code snippet that reproduces it, and your Node version (`node -v`).

## Code style

- Match the style already in the file: `'use strict'`, single quotes, small functions, comments that explain *why*, not *what*.
- Keep the public API surface small. New exports need a strong reason in the issue discussion first.

Questions? Open an issue — that is what they are for.
