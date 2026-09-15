# pi-permission-system — @svetlovtech fork

Public fork of the permission enforcement extension for the [Pi](https://pi.mariozechner.at/) coding agent.

## Upstream attribution

- Upstream npm package: `@gotgenes/pi-permission-system`
- Upstream repo: https://github.com/gotgenes/pi-packages (monorepo; this package lives at `packages/pi-permission-system`)
- Baseline: `32.0.1` (pi-packages commit `a867122d`)
- Machine-readable metadata: `.upstream-version`

> The old standalone repo https://github.com/gotgenes/pi-permission-system is
> **archived** ("Moved to gotgenes/pi-packages"). The live upstream is
> `gotgenes/pi-packages`.

## Fork features (on top of the upstream baseline)

| Feature | Where | Notes |
|---|---|---|
| External resolve hook | `src/authority/permission-dialog.ts`, `src/authority/local-user-authorizer.ts`, `src/authority/permission-prompter.ts`, `src/authority/permission-prompt-component.ts` | An external extension (e.g. `pi-telegram-bridge`) can answer the permission dialog: `externalResolve` option + `pi-telegram-bridge:resolve-permission` event subscription. `buildRequestOptions` keeps its `events` param (upstream removed it). |
| "Allow forever" hotkey | `src/authority/permission-prompt-decision.ts`, `src/authority/permission-prompt-component.ts`, `src/presentation/pattern-suggest.ts`, `src/policy/permission-gate.ts`, `src/handlers/gates/runner.ts`, `src/handlers/gates/descriptor.ts`, `src/index.ts`, `src/forever-approval-recorder.ts` | Hotkey `f` resolves as `approved_forever`, persisted to config via `ConfigForeverApprovalRecorder` (`src/forever-approval-recorder.ts`, local-only file). Gate carries `foreverApproval` as `{ grants }` via `toForwardedData()`. `SessionApprovalSuggestion.foreverLabel` is optional (fork). |
| Full-request pager | `src/authority/permission-prompt-component.ts` | `ctrl+o` pager bounded to terminal height (`getTerminalRows` ctor param — upstream dropped it); `↑/↓`, `j/k`, PgUp/PgDn, Home/End, Enter scroll; letters decide directly. |
| MCP tool-input preview | `src/tool-input/builtin-tool-input-formatters.ts`, `src/tool-input/tool-input-preview.ts` | Built-in `mcp` formatter; `TOOL_INPUT_PREVIEW_MAX_LENGTH = Infinity` (renderer decides elision), log preview capped at 1000. |

## Syncing upstream updates

1. Extract the new tree from the upstream monorepo: `git archive <commit> packages/pi-permission-system | tar -x --strip-components=2 -C /tmp/ps-upstream`.
2. Copy upstream files in (skip monorepo plumbing: `scripts/`, `rollup.dts.config.mjs`, their `AGENTS.md`), keeping this repo's `.gitignore`, `.upstream-version`, `AGENTS.md`, and `src/forever-approval-recorder.ts`.
3. Files NOT locally modified can be taken wholesale. Files in the table above are locally modified — resolve upstream changes there with a 3-way merge (`git merge-file`) against the npm-snapshot base of the previous baseline. Never revert `src/forever-approval-recorder.ts`.
4. Update `baselineVersion`/`baselineCommit` in `.upstream-version`.

## Build / check

> **Runtime deps are REQUIRED for Pi to load the extension.** 32.0.1 added
> third-party runtime deps (`zod`, `tree-sitter-bash`, `web-tree-sitter`).
> Without `node_modules/` Pi fails with `Cannot find module 'zod'` at startup.

- Install runtime deps: `sed 's/"catalog:"/"latest"/g' package.json && npm install --omit=dev --no-save && git checkout -- package.json` (upstream pins deps via pnpm catalogs npm cannot read; `@earendil-works/*` imports are provided by Pi itself — do not install them).
- Syntax/import gate: `bun build src/index.ts --target=bun --external "@earendil-works/*" --outdir=/tmp/builddrop`.
- Type gate: `npx tsc --noEmit` with a config stubbing the monorepo `tsconfig.base.json` (lib es2023, moduleResolution bundler, types node).
- No tests are run in this fork's working copy (vitest deps are in the upstream package, not vendored).
