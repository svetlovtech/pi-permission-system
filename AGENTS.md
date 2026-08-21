# pi-permission-system — local fork

Permission enforcement extension for the Pi coding agent.

## Upstream

- npm package: `@gotgenes/pi-permission-system`
- repo: https://github.com/gotgenes/pi-packages (monorepo, this package lives in `packages/pi-permission-system`)
- Pi loads THIS fork (not the npm package): `~/.pi/agent/settings.json` → `/home/dev/pi-forks/pi-permission-system`

## Baseline

- Fork is based on `@gotgenes/pi-permission-system@25.4.0` (npm copy snapshot).
- Baseline commit: `c464d68` ("baseline: @gotgenes/pi-permission-system v25.4.0 (npm copy)").
- See `.upstream-version` for machine-readable metadata.

## Local changes (ours, on top of baseline)

| Area | Files | Why |
|---|---|---|
| Telegram bridge resolve hook | `authority/permission-dialog.ts`, `authority/local-user-authorizer.ts`, `authority/permission-prompter.ts`, `authority/permission-prompt-component.ts` | `pi-telegram-bridge` extension can resolve a permission ask from Telegram: `externalResolve` option + `pi-telegram-bridge:resolve-permission` event subscription. |
| "Allow forever" option | `authority/permission-prompt-decision.ts`, `authority/permission-prompt-component.ts`, `pattern-suggest.ts`, `permission-gate.ts`, `handlers/gates/runner.ts`, `handlers/gates/descriptor.ts`, `handlers/gates/tool.ts`, `index.ts`, `forever-approval-recorder.ts` (new) | Adds the `(f)` hotkey + `approved_forever` resolution and persists forever grants to config. |
| MCP input preview | `builtin-tool-input-formatters.ts`, `tool-input-preview.ts` | Built-in `mcp` formatter showing tool args (`with name: ..., command: [...]`); preview length defaults raised to `Infinity` so the renderer (not the formatter) decides elision. |
| Full-request pager | `authority/permission-prompt-component.ts` | `ctrl+o` opens a pager bounded to terminal height: `↑/↓`, `j/k`, `PageUp/PageDown`, `Home/End`, `Enter` scroll inside the dialog; `esc` returns to compact view; letters `y/s/f/n/r` decide directly. |

## Syncing upstream updates

Run from the repo root:

```bash
../sync-upstream.sh          # compares .upstream-version vs npm latest, applies non-conflicting updates
git status                   # review: "CONFLICT" files need manual merge
```

Manual (reference):

```bash
git fetch upstream https://github.com/gotgenes/pi-packages 2>/dev/null || git remote add upstream https://github.com/gotgenes/pi-packages
git log upstream/main --oneline -- packages/pi-permission-system   # what changed upstream
git diff c464d68 upstream/main -- packages/pi-permission-system    # upstream delta vs our baseline
```

Rules:
- Files NOT locally modified can be auto-updated (the sync script does this).
- Files in the table above are locally modified — upstream changes there need a MANUAL merge.
- Never revert `forever-approval-recorder.ts` (local-only file, absent upstream).
- After syncing, update `baselineVersion`/`baselineCommit` in `.upstream-version` and commit.

## Build / check

- `bun build src/index.ts --target=bun --external "@earendil-works/*" --outdir=/tmp/builddrop` (the package uses `#src/*` import map; plain `bun build` from src/ may fail on `#src` — the sync script / previous sessions copy src to /tmp and rewrite imports, or run from the package root where `imports` resolves).
- No tests are run in this fork's working copy (vitest deps are in the upstream package, not vendored).
