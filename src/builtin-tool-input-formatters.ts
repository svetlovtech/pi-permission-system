/**
 * Built-in tool input formatters registered through the public seam at startup.
 *
 * Each formatter here dogfoods `ToolInputFormatterRegistry.register` — it goes
 * through exactly the same path a third-party extension would use.
 */

import type {
  ToolInputFormatter,
  ToolInputFormatterRegistry,
} from "./tool-input-formatter-registry";
import { truncateInlineText } from "./tool-input-preview";
import { toRecord } from "./value-guards";

/** Maximum total length of the generated argument summary (before "with " prefix). */
const MCP_ARGS_SUMMARY_MAX_LENGTH = Number.POSITIVE_INFINITY;

/** Maximum length of a single string argument value (before quoting). */
const MCP_ARG_VALUE_MAX_LENGTH = Number.POSITIVE_INFINITY;

/** How many leading array items to render before an ellipsis. */
const MCP_ARRAY_PREVIEW_ITEMS = Number.POSITIVE_INFINITY;

/**
 * Parse a JSON-string argument payload.
 *
 * pi's unified `mcp` proxy tool accepts `args` as either an object or a JSON
 * string; the string form must be decoded before it can be previewed.
 * Returns `undefined` for anything that is not a parseable JSON object.
 */
function tryParseJsonArgs(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Render a single MCP argument value as a compact, readable fragment.
 *
 * - Strings: quoted and truncated.
 * - Numbers / booleans: plain string conversion.
 * - Arrays: leading items rendered inline (an exec `command` is meaningless
 *   as `[N items]` — the operator needs to see what will run), then `…`.
 * - Objects: `{…}`.
 * - Everything else: plain string conversion.
 */
function renderArgValue(value: unknown): string {
  if (typeof value === "string") {
    return `"${truncateInlineText(value, MCP_ARG_VALUE_MAX_LENGTH)}"`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const shown = value.slice(0, MCP_ARRAY_PREVIEW_ITEMS);
    const items = shown.map(renderArgValue).join(", ");
    const rest = value.length > shown.length ? ", \u2026" : "";
    return `[${items}${rest}]`;
  }
  if (typeof value === "object" && value !== null) {
    return "{…}";
  }
  return String(value);
}

/**
 * Format an MCP tool call's arguments payload as a human-readable summary.
 *
 * The arguments are read from `input.args` (pi's unified `mcp` proxy tool
 * shape — an object, or a JSON string) or, as a fallback, `input.arguments`
 * (the MCP protocol shape). Both are accepted so the ask-prompt previews the
 * real arguments regardless of how the call reached the gate.
 *
 * Returns `undefined` when the arguments are absent or empty — the MCP
 * ask-prompt is then left unchanged (no suffix appended).
 *
 * Intended to be registered as the `"mcp"` formatter via
 * `registerBuiltinToolInputFormatters`.
 */
export const formatMcpInputForPrompt: ToolInputFormatter = (
  input: Record<string, unknown>,
): string | undefined => {
  const rawArgs = input.args ?? input.arguments;
  const args = tryParseJsonArgs(rawArgs) ?? toRecord(rawArgs);
  const entries = Object.entries(args);
  if (entries.length === 0) return undefined;

  const parts = entries.map(
    ([key, value]) => `${key}: ${renderArgValue(value)}`,
  );
  const summary = truncateInlineText(
    parts.join(", "),
    MCP_ARGS_SUMMARY_MAX_LENGTH,
  );
  return `with ${summary}`;
};

/**
 * Register all built-in tool input formatters into `registry`.
 *
 * Called once from the extension factory (`index.ts`) immediately after the
 * registry is constructed, before any third-party registration can occur.
 */
export function registerBuiltinToolInputFormatters(
  registry: ToolInputFormatterRegistry,
): void {
  registry.register("mcp", formatMcpInputForPrompt);
}
