import type {
  ExtensionContext,
  ExtensionUIContext,
  KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import { type Component, matchesKey } from "@earendil-works/pi-tui";
import {
  type PermissionPromptDecision,
  type RequestPermissionOptions,
  requestPermissionDecisionFromUi,
} from "#src/authority/permission-dialog";
import {
  initialPromptState,
  type PromptEvent,
  type PromptKey,
  type PromptModelConfig,
  type PromptViewState,
  reducePrompt,
} from "#src/authority/permission-prompt-decision";
import {
  completeViewBudget,
  type DialogView,
  type RenderBudget,
  renderPromptDialog,
} from "#src/presentation/dialog-renderer";
import { fitLinesToWidth } from "#src/presentation/line-fitting";
import type { PromptPayload } from "#src/presentation/prompt-payload";

/**
 * Inline `ctx.ui.custom` permission dialog for TUI sessions.
 *
 * All interaction logic lives in the pure {@link reducePrompt} model; this
 * module is the thin adapter that renders the model's state to lines, maps raw
 * keystrokes to {@link PromptEvent}s, and resolves the `ctx.ui.custom` promise
 * with the committed {@link PermissionPromptDecision}. The component renders
 * inline (never as an overlay).
 */

/** The subset of the session UI surface the inline dialog needs. */
export type PermissionPromptUi = Pick<
  ExtensionUIContext,
  "select" | "input" | "custom" | "getToolsExpanded" | "setToolsExpanded"
>;

/** The keybindings surface the dialog consults; only `matches` is read (ISP). */
type PromptKeybindings = Pick<KeybindingsManager, "matches">;

/** The resolved presentation context selected once per activation. */
export interface PermissionPromptView extends PromptPreferences {
  mode: ExtensionContext["mode"];
  ui: PermissionPromptUi;
}

/** Live prompt-behavior preferences read at prompt time (see `doublePressToConfirm`). */
export interface PromptPreferences {
  doublePressToConfirm: boolean;
  /** How much room a render has; the terminal width is added per frame. */
  budget: RenderBudget;
}

/**
 * Route a permission ask to the inline keybind dialog in TUI mode, or the
 * `select()`/`input()` flow otherwise (RPC / frontend — the #519 constraint).
 *
 * The single entry the `LocalUserAuthorizer` calls; keeps the mode dispatch in
 * one place so the fallback and the inline component never both render.
 */
export function requestPermissionDecision(
  view: PermissionPromptView,
  title: string,
  payload: PromptPayload,
  options?: RequestPermissionOptions,
): Promise<PermissionPromptDecision> {
  if (view.mode === "tui") {
    return presentInlinePermissionPrompt(view, title, payload, options);
  }
  // The fallback renders once and cannot re-render, so it neither paints nor
  // offers an expansion; it substitutes a nominal width for the terminal size
  // it is never told, and the host's own select wraps from there.
  const rendered = renderPromptDialog(payload, {
    ...view.budget,
    width: FALLBACK_RENDER_WIDTH,
  });
  return requestPermissionDecisionFromUi(
    view.ui,
    title,
    rendered.lines.join("\n"),
    options,
  );
}

/** The width the `select`/`input` fallback renders against. */
const FALLBACK_RENDER_WIDTH = 80;

/** Minimal theme surface the dialog uses; satisfied by the real SDK theme. */
interface PromptTheme {
  fg(color: string, text: string): string;
}

const DEFAULT_SESSION_LABEL = "Yes, for this session";
const DEFAULT_FOREVER_LABEL = "Yes, allow forever";

const OPTION_LABELS: Record<PromptKey, string> = {
  y: "Yes",
  s: DEFAULT_SESSION_LABEL,
  f: DEFAULT_FOREVER_LABEL,
  n: "No",
  r: "No, provide reason",
};

const OPTION_ORDER: readonly PromptKey[] = ["y", "s", "f", "n", "r"];

/** Fixed chrome rows in the expanded pager: title, two blanks, hint. */
const EXPANDED_CHROME_ROWS = 5;
/** Terminal rows assumed when the real size is unavailable. */
const FALLBACK_TERMINAL_ROWS = 30;

export function presentInlinePermissionPrompt(
  view: PermissionPromptView,
  title: string,
  payload: PromptPayload,
  options?: RequestPermissionOptions,
): Promise<PermissionPromptDecision> {
  const config: PromptModelConfig = {
    doublePressToConfirm: view.doublePressToConfirm,
    sessionLabel: options?.sessionLabel ?? DEFAULT_SESSION_LABEL,
    foreverLabel: options?.foreverLabel ?? DEFAULT_FOREVER_LABEL,
    sessionScope: options?.sessionScope,
  };
  return view.ui.custom<PermissionPromptDecision>(
    (tui, theme, keybindings, done) => {
      const component = new PermissionPromptComponent(
        theme,
        config,
        title,
        payload,
        view.budget,
        (data) => handleToolsExpandAction(data, keybindings, view.ui),
        () => {
          tui.requestRender();
        },
        (decision) => done(decision),
        () => tui.terminal.rows,
      );

      // Telegram-bridge hook: when the user answers the permission ask in
      // Telegram first, the bridge emits pi-telegram-bridge:resolve-permission
      // and this dialog completes with the injected decision.
      const channel = "pi-telegram-bridge:resolve-permission";
      const ext = options?.externalResolve;
      let unsubscribe: (() => void) | undefined;
      if (ext) {
        const handler = (data: unknown) => {
          const msg = (data ?? {}) as Record<string, unknown>;
          if (msg.requestId !== ext.requestId) return;
          unsubscribe?.();
          done(toPermissionDecision(msg.decision as unknown));
        };
        unsubscribe = ext.events.on(channel, handler);
        // Re-capture done so the component's terminal path and the bridge
        // path both resolve exactly once. done is idempotent per pi contract.
        void component;
      }

      return component;
    },
    { overlay: false },
  );
}

/** Normalize an untrusted resolved permission-decision payload. */
function toPermissionDecision(raw: unknown): PermissionPromptDecision {
  if (typeof raw === "object" && raw !== null) {
    const r = raw as Record<string, unknown>;
    if (r.approved === true && typeof r.state === "string") {
      return {
        approved: true,
        state: r.state as PermissionPromptDecision["state"],
      };
    }
    if (r.approved === false && typeof r.state === "string") {
      return { approved: false, state: r.state as PermissionPromptDecision["state"] };
    }
  }
  // Unrecognised → deny with reason (safe default for a permission gate).
  return { approved: false, state: "denied" };
}

/**
 * Forward Pi's tool-expansion action while the dialog holds keyboard focus.
 *
 * A focused `ctx.ui.custom` component consumes every keystroke, so `Ctrl+O`
 * would otherwise be dead for the duration of an ask — exactly when the user
 * most needs to see the full pending tool invocation. Returns `true` when the
 * keystroke was the action (and was handled), so the caller stops before
 * mapping it to a {@link PromptEvent}; expansion is a display concern and must
 * never reach the decision model.
 *
 * Deliberately does not request a render: `setToolsExpanded` re-renders the
 * host itself, and the dialog's own lines are unaffected by tool expansion.
 */
function handleToolsExpandAction(
  data: string,
  keybindings: PromptKeybindings,
  ui: PermissionPromptUi,
): boolean {
  if (!keybindings.matches(data, "app.tools.expand")) {
    return false;
  }
  ui.setToolsExpanded(!ui.getToolsExpanded());
  return true;
}

class PermissionPromptComponent implements Component {
  private state: PromptViewState;
  private reasonBuffer = "";
  /** Whether the operator asked to see the complete request (ADR 0011 §4). */
  private expanded = false;
  /** Scroll offset into the expanded full-request render (pager mode). */
  private scrollOffset = 0;
  /** Total lines of the last expanded render, for paging bounds. */
  private lastExpandedTotal = 0;
  /** Content rows available in the last expanded render, for paging bounds. */
  private lastExpandedAvailable = 0;

  constructor(
    private readonly theme: PromptTheme,
    private readonly config: PromptModelConfig,
    private readonly title: string,
    private readonly payload: PromptPayload,
    private readonly budget: RenderBudget,
    private readonly handleAppAction: (data: string) => boolean,
    private readonly requestRender: () => void,
    private readonly done: (decision: PermissionPromptDecision) => void,
    private readonly getTerminalRows: () => number,
  ) {
    this.state = initialPromptState(config);
  }

  invalidate(): void {
    // No cached rendering state to clear.
  }

  render(width: number): string[] {
    return fitLinesToWidth(this.renderStep(width), width);
  }

  private renderStep(width: number): string[] {
    switch (this.state.step) {
      case "decision":
        return this.renderDecision(width);
      case "reason":
        return this.renderReason(width);
      case "scope":
        return this.renderScope();
    }
  }

  /**
   * The ask itself, bounded to the budget at this frame's width.
   *
   * Rendered per frame rather than once, because the row budget is a function
   * of the width the host gives us, which a resize changes.
   */
  private renderAsk(width: number): DialogView {
    return renderPromptDialog(
      this.payload,
      this.expanded ? completeViewBudget(width) : { ...this.budget, width },
      (text) => this.theme.fg("warning", text),
    );
  }

  /**
   * The key hints, naming the expansion only when it would do something.
   *
   * An affordance advertised when there is nothing to expand is noise; one
   * left unadvertised when the render dropped something is a decision made
   * without the evidence.
   */
  private hint(view: DialogView): string {
    const keys = [
      "↑/↓ move",
      "enter confirm",
      "esc deny",
      "press a letter, then again to confirm",
    ];
    if (this.expanded) {
      keys.push("ctrl+o collapse");
    } else if (view.elided) {
      keys.push("ctrl+o full request");
    }
    return this.theme.fg("muted", keys.join(" · "));
  }

  handleInput(data: string): void {
    if (this.state.step === "reason") {
      this.handleReasonInput(data);
      return;
    }
    if (this.handleAppAction(data)) {
      // One "expand" for the operator: the host expands its pending tool call
      // and the dialog expands its own render, on the same keystroke.
      this.expanded = !this.expanded;
      this.scrollOffset = 0;
      this.requestRender();
      return;
    }
    if (this.state.step === "decision" && this.expanded) {
      if (this.handleExpandedScroll(data)) {
        return;
      }
      if (matchesKey(data, "escape")) {
        // In the pager, escape returns to the compact dialog rather than
        // denying outright: a mis-press while reading must not decide.
        this.expanded = false;
        this.scrollOffset = 0;
        this.requestRender();
        return;
      }
    }
    const event = this.toEvent(data);
    if (event) {
      this.apply(event);
    }
  }

  private handleReasonInput(data: string): void {
    if (matchesKey(data, "enter")) {
      this.apply({ type: "submitReason", draft: this.reasonBuffer });
      return;
    }
    if (matchesKey(data, "escape")) {
      this.reasonBuffer = "";
      this.apply({ type: "cancel" });
      return;
    }
    if (matchesKey(data, "backspace")) {
      this.reasonBuffer = this.reasonBuffer.slice(0, -1);
      this.requestRender();
      return;
    }
    if (isPrintable(data)) {
      this.reasonBuffer += data;
      this.requestRender();
    }
  }

  private toEvent(data: string): PromptEvent | undefined {
    if (matchesKey(data, "up") || matchesKey(data, "k")) {
      return { type: "nav", direction: "up" };
    }
    if (matchesKey(data, "down") || matchesKey(data, "j")) {
      return { type: "nav", direction: "down" };
    }
    if (matchesKey(data, "enter")) {
      return { type: "confirm" };
    }
    if (matchesKey(data, "escape")) {
      return { type: "cancel" };
    }
    if (this.state.step === "decision") {
      const key = OPTION_ORDER.find((option) => matchesKey(data, option));
      if (key) {
        return { type: "hotkey", key };
      }
    }
    return undefined;
  }

  private apply(event: PromptEvent): void {
    const outcome = reducePrompt(this.config, this.state, event);
    if (outcome.kind === "decision") {
      this.done(outcome.decision);
      return;
    }
    if (outcome.state.step === "reason" && this.state.step !== "reason") {
      this.reasonBuffer = "";
    }
    if (outcome.state.step !== "decision") {
      // Reason and scope steps render the compact ask; leave the pager.
      this.expanded = false;
      this.scrollOffset = 0;
    }
    this.state = outcome.state;
    this.requestRender();
  }

  private renderDecision(width: number): string[] {
    if (this.expanded) {
      return this.renderExpandedDecision(width);
    }
    const ask = this.renderAsk(width);
    const lines = [this.theme.fg("accent", this.title), ...ask.lines, ""];
    for (const key of OPTION_ORDER) {
      const label =
        key === "s"
          ? this.config.sessionLabel
          : key === "f"
            ? this.config.foreverLabel
            : OPTION_LABELS[key];
      const selected = this.state.highlightedKey === key;
      const marker = selected ? "▶" : " ";
      const row = `${marker} (${key}) ${label}`;
      lines.push(selected ? this.theme.fg("accent", row) : row);
    }
    lines.push("");
    lines.push(this.state.hint || this.hint(ask));
    return lines;
  }

  /**
   * The expanded pager: the complete request, bounded to the terminal so the
   * dialog never overflows the viewport (and the transcript scroll is never
   * touched). Scrolling is paged with ↑/↓ (and j/k, pageUp/pageDown,
   * home/end); decisions stay one keystroke away via the letter hotkeys.
   */
  private renderExpandedDecision(width: number): string[] {
    const ask = this.renderAsk(width);
    const total = ask.lines.length;
    const reported = this.getTerminalRows();
    const rows = reported > 0 ? reported : FALLBACK_TERMINAL_ROWS;
    const available = Math.max(5, rows - EXPANDED_CHROME_ROWS);
    const maxOffset = Math.max(0, total - available);
    this.scrollOffset = Math.min(Math.max(0, this.scrollOffset), maxOffset);
    this.lastExpandedTotal = total;
    this.lastExpandedAvailable = available;
    const window = ask.lines.slice(
      this.scrollOffset,
      this.scrollOffset + available,
    );
    return [
      this.theme.fg("accent", this.title),
      "",
      ...window,
      "",
      this.state.hint || this.expandedHint(total > available),
    ];
  }

  /**
   * The pager hint: scroll position when the request overflows, the letter
   * hotkeys (the options list is hidden in the pager), and the way back.
   */
  private expandedHint(scrolled: boolean): string {
    const parts: string[] = [];
    if (scrolled) {
      parts.push(
        `↑/↓ scroll · ${this.scrollOffset + 1}/${this.lastExpandedTotal}`,
      );
    }
    parts.push("y yes · s session · f forever · n no · r reason");
    parts.push("esc back · ctrl+o collapse");
    return this.theme.fg("muted", parts.join(" · "));
  }

  /**
   * Pager scroll keys for the expanded view. Returns true when the keystroke
   * was a scroll action (handled); false when it should fall through to the
   * decision model. Enter is always consumed here so a read cannot confirm
   * the hidden highlighted option by accident.
   */
  private handleExpandedScroll(data: string): boolean {
    const maxOffset = Math.max(
      0,
      this.lastExpandedTotal - this.lastExpandedAvailable,
    );
    const page = Math.max(1, this.lastExpandedAvailable - 1);
    let next: number | undefined;
    if (matchesKey(data, "up") || matchesKey(data, "k")) {
      next = this.scrollOffset - 1;
    } else if (matchesKey(data, "down") || matchesKey(data, "j")) {
      next = this.scrollOffset + 1;
    } else if (matchesKey(data, "enter")) {
      next = this.scrollOffset + 1;
    } else if (matchesKey(data, "pageUp")) {
      next = this.scrollOffset - page;
    } else if (matchesKey(data, "pageDown")) {
      next = this.scrollOffset + page;
    } else if (matchesKey(data, "home")) {
      next = 0;
    } else if (matchesKey(data, "end")) {
      next = maxOffset;
    } else {
      return false;
    }
    const clamped = Math.min(Math.max(0, next), maxOffset);
    if (clamped !== this.scrollOffset) {
      this.scrollOffset = clamped;
      this.requestRender();
    }
    return true;
  }

  private renderReason(width: number): string[] {
    const lines = [
      this.theme.fg("accent", this.title),
      ...this.renderAsk(width).lines,
      "",
      `Reason (required): ${this.reasonBuffer}\u2588`,
    ];
    if (this.state.reasonError) {
      lines.push(this.theme.fg("error", this.state.reasonError));
    }
    lines.push("");
    lines.push(this.theme.fg("muted", "enter submit · esc back"));
    return lines;
  }

  private renderScope(): string[] {
    const scope = this.config.sessionScope;
    const subagentLabel = scope?.subagentLabel ?? "This subagent only";
    const servingLabel = scope?.servingSessionLabel ?? "The whole session";
    const rows: Array<{ label: string; serving: boolean }> = [
      { label: subagentLabel, serving: false },
      { label: servingLabel, serving: true },
    ];
    const lines = [
      this.theme.fg("accent", this.title),
      "Apply this session grant to:",
      "",
    ];
    for (const row of rows) {
      const selected = this.state.scopeServing === row.serving;
      const marker = selected ? "▶" : " ";
      const text = `${marker} ${row.label}`;
      lines.push(selected ? this.theme.fg("accent", text) : text);
    }
    lines.push("");
    lines.push(this.theme.fg("muted", "↑/↓ move · enter confirm · esc back"));
    return lines;
  }
}

function isPrintable(data: string): boolean {
  if (data.length !== 1) {
    return false;
  }
  const code = data.charCodeAt(0);
  return code >= 0x20 && code !== 0x7f;
}
