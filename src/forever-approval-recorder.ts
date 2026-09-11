import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import { getGlobalConfigPath } from "#src/config/config-paths";
import { loadUnifiedConfig } from "#src/config/config-loader";
import type { SessionApproval } from "#src/session/session-approval";

/**
 * Persists an "allow forever" gate decision into the global config.json as a
 * standing `allow` rule.
 *
 * Unlike {@link SessionRules} (ephemeral, cleared on session shutdown), a
 * forever grant is written to disk under `permission[surface][pattern] = "allow"`
 * so it survives restarts and `/reload` cycles. The policy loader's cache is
 * keyed on the config file's mtime (see `getCacheStamp`), so the written rule
 * is picked up on the very next permission check without any explicit invalidation.
 */
export interface ForeverApprovalRecorder {
  recordForeverApproval(approval: SessionApproval): void;
}

export class ConfigForeverApprovalRecorder implements ForeverApprovalRecorder {
  constructor(private readonly agentDir: string) {}

  /**
   * Record every pattern from `approval` as a config-level `allow` rule.
   *
   * Each pattern is written independently so a single approval can cover
   * several rules (mirroring `SessionRules.recordSessionApproval`).
   */
  recordForeverApproval(approval: SessionApproval): void {
    for (const grant of approval.grants) {
      this.persistRule(grant.surface, grant.pattern);
    }
  }

  private persistRule(surface: string, pattern: string): void {
    const configPath = getGlobalConfigPath(this.agentDir);
    const existing = loadUnifiedConfig(configPath);
    const permission = existing.config.permission ?? {};

    // The current `permission` value may be a nested map (surface -> pattern -> state)
    // or a flat map. Guard against a non-object to avoid corrupting the file.
    const existingSurface =
      typeof permission[surface] === "object" && permission[surface] !== null
        ? permission[surface]
        : {};
    const surfaceRules = { ...existingSurface };
    surfaceRules[pattern] = "allow";

    const next = {
      ...existing.config,
      permission: {
        ...permission,
        [surface]: surfaceRules,
      },
    };

    const tmpPath = `${configPath}.tmp`;
    try {
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(tmpPath, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
      renameSync(tmpPath, configPath);
    } catch (error) {
      // Best-effort cleanup of the temp file.
      try {
        if (existsSync(tmpPath)) rmSync(tmpPath);
      } catch {
        // Ignore cleanup failures.
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to persist forever-approval to '${configPath}': ${message}`,
      );
    }
  }
}
