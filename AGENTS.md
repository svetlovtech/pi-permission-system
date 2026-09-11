# pi-permission-system — local fork

Permission enforcement extension for the Pi coding agent.

## Upstream

- npm package: `@gotgenes/pi-permission-system`
- repo: https://github.com/gotgenes/pi-packages (monorepo, this package lives in `packages/pi-permission-system`)
- Pi loads THIS fork (not the npm package): `~/.pi/agent/extensions/svetlovtech-pi-permission-system`
- GitHub mirror (origin): https://github.com/svetlovtech/pi-permission-system (private, standalone repo). Push: `git push origin main`.

> Note: the old standalone repo https://github.com/gotgenes/pi-permission-system is
> **archived** ("Moved to gotgenes/pi-packages"). The live upstream is
> `gotgenes/pi-packages` — do NOT sync from the old repo.

## Baseline

- Fork is based on `@gotgenes/pi-permission-system@32.0.1` (pi-packages `packages/pi-permission-system` tree).
- Baseline commit: `a867122d`.
- See `.upstream-version` for machine-readable metadata.

> 32.0.1 restructured the tree: flat modules moved into `config/`, `logging/`,
> `policy/`, `presentation/`, `session/`, `tool-input/`. Local changes below
> already live at the new paths.

## Local changes (ours, on top of baseline)

| Area | Files | Why |
|---|---|---|
| Telegram bridge resolve hook | `src/authority/permission-dialog.ts`, `src/authority/local-user-authorizer.ts`, `src/authority/permission-prompter.ts`, `src/authority/permission-prompt-component.ts` | `pi-telegram-bridge` can resolve a permission ask from Telegram: `externalResolve` option + `pi-telegram-bridge:resolve-permission` event subscription. `buildRequestOptions` keeps its `events` param (upstream removed it). |
| "Allow forever" option | `src/authority/permission-prompt-decision.ts`, `src/authority/permission-prompt-component.ts`, `src/presentation/pattern-suggest.ts`, `src/policy/permission-gate.ts`, `src/handlers/gates/runner.ts`, `src/handlers/gates/descriptor.ts`, `src/index.ts`, `src/forever-approval-recorder.ts` (local-only) | `(f)` hotkey + `approved_forever` resolution, persisted to config via `ConfigForeverApprovalRecorder`. Gate carries `foreverApproval` as `{ grants }` (via `toForwardedData()`). `SessionApprovalSuggestion.foreverLabel` is optional (fork). |
| Full-request pager | `src/authority/permission-prompt-component.ts` | `ctrl+o` pager bounded to terminal height (`getTerminalRows` ctor param — upstream dropped it); `↑/↓`, `j/k`, PgUp/PgDn, Home/End, Enter scroll; letters decide directly. |
| MCP input preview | `src/tool-input/builtin-tool-input-formatters.ts`, `src/tool-input/tool-input-preview.ts` | Built-in `mcp` formatter; `TOOL_INPUT_PREVIEW_MAX_LENGTH = Infinity` (renderer decides elision), log preview capped at 1000. |

## Syncing upstream updates

```bash
git remote add upstream https://github.com/gotgenes/pi-packages 2>/dev/null
git fetch upstream
# upstream delta vs current baseline:
git diff $(python3 -c "import json;print(json.load(open('.upstream-version'))['baselineCommit'])") upstream/main -- packages/pi-permission-system
```

The 32.0.1 sync procedure (repeat for future versions):

1. Extract the new tree: `git archive <commit> packages/pi-permission-system | tar -x --strip-components=2 -C /tmp/ps-upstream`.
2. Clear tracked files (keep `.gitignore`, `.upstream-version`, `AGENTS.md`, `src/forever-approval-recorder.ts`), copy theirs in (skip monorepo plumbing: `scripts/`, `rollup.dts.config.mjs`, their `AGENTS.md`).
3. Re-apply local changes (table above) — ours-modified files need a `git merge-file` 3-way vs the npm-snapshot base of the previous baseline.
4. Type check: deps are `catalog:` in upstream — `sed 's/"catalog:"/"latest"/g' package.json && npm install --no-save && git checkout -- package.json`, then `npx tsc --noEmit` with a local config stubbing `tsconfig.base.json` (lib es2023, moduleResolution bundler, types node).
5. `bun build src/index.ts --target=bun --external "@earendil-works/*" --outdir=/tmp/builddrop`.
6. Update `baselineVersion`/`baselineCommit` in `.upstream-version`, commit, push.

Rules:
- Files NOT locally modified can be taken from upstream wholesale.
- Files in the table above are locally modified — upstream changes there need a MANUAL merge.
- Never revert `src/forever-approval-recorder.ts` (local-only file, absent upstream).
- `node_modules/` is gitignored; the old tracked symlink to `/home/dev/...` is gone.

## Build / check

- Deps for type check: `sed 's/"catalog:"/"latest"/g' package.json && npm install --no-save && git checkout -- package.json` (upstream pins devDeps via pnpm catalogs npm cannot read).
- `bun build src/index.ts --target=bun --external "@earendil-works/*" --outdir=/tmp/builddrop` — syntax/import gate.
- `npx tsc --noEmit` with a config stubbing the monorepo `tsconfig.base.json` (lib es2023, moduleResolution bundler, types node) — full type gate.
- No tests are run in this fork's working copy (vitest deps are in the upstream package, not vendored).
