/**
 * Security CLI — manage WriteGate and security configuration.
 *
 * Commands:
 *   security setup       — interactive security configuration
 *   security show        — display current security config
 *   security add-user    — add user to writeToolAllowList
 *   security remove-user — remove user from writeToolAllowList
 */

import { createInterface } from "node:readline";
import { readFile } from "node:fs/promises";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { createLogger } from "../utils/logger.js";
import { defaultConfigPath } from "../utils/paths.js";
import { updateYamlFileAtomic } from "../models/config-file.js";

const log = createLogger("security-cli");

// ── Helpers ────────────────────────────────────────────────────────────────

function resolveConfigPath(): string {
  return process.env.OWLIABOT_CONFIG_PATH ?? defaultConfigPath();
}

async function loadAppYaml(configPath: string): Promise<Record<string, unknown>> {
  const raw = await readFile(configPath, "utf-8");
  return (parseYaml(raw) ?? {}) as Record<string, unknown>;
}

function getSecuritySection(config: Record<string, unknown>): Record<string, unknown> {
  return (config.security ?? {}) as Record<string, unknown>;
}

function ask(rl: ReturnType<typeof createInterface>, prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

function askYN(rl: ReturnType<typeof createInterface>, prompt: string, defaultVal: boolean): Promise<boolean> {
  const hint = defaultVal ? "[Y/n]" : "[y/N]";
  return new Promise((resolve) => {
    rl.question(`${prompt} ${hint} `, (answer) => {
      const trimmed = answer.trim().toLowerCase();
      if (trimmed === "") resolve(defaultVal);
      else resolve(trimmed === "y" || trimmed === "yes");
    });
  });
}

// ── Commands ───────────────────────────────────────────────────────────────

/**
 * `owliabot security show` — display current security config
 */
export async function securityShow(): Promise<void> {
  const configPath = resolveConfigPath();
  const config = await loadAppYaml(configPath);
  const security = getSecuritySection(config);

  if (Object.keys(security).length === 0) {
    log.info("No security section found in config.");
    log.info(`Config path: ${configPath}`);
    log.info('Run "owliabot security setup" to configure.');
    return;
  }

  log.info("━━━ Security Configuration ━━━");
  log.info(`Config: ${configPath}`);
  log.info("");
  log.info(`  writeGateEnabled:      ${security.writeGateEnabled ?? "(not set, defaults to true)"}`);
  log.info(`  writeToolConfirmation: ${security.writeToolConfirmation ?? "(not set, defaults to true)"}`);

  const allowList = security.writeToolAllowList;
  if (Array.isArray(allowList) && allowList.length > 0) {
    log.info(`  writeToolAllowList:`);
    for (const id of allowList) {
      log.info(`    - ${id}`);
    }
  } else {
    log.info(`  writeToolAllowList:    (empty — all write tools blocked)`);
  }

  const timeoutMs = security.writeToolConfirmationTimeoutMs;
  if (timeoutMs != null) {
    log.info(`  confirmationTimeout:   ${timeoutMs}ms`);
  }
}

/**
 * `owliabot security setup` — interactive security configuration
 */
export async function securitySetup(): Promise<void> {
  const configPath = resolveConfigPath();
  const config = await loadAppYaml(configPath);
  const existing = getSecuritySection(config);

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    log.info("━━━ Security Setup ━━━");
    log.info(`Config: ${configPath}`);
    log.info("");

    // writeGateEnabled
    const currentGate = existing.writeGateEnabled;
    const gateDefault = currentGate != null ? Boolean(currentGate) : true;
    const writeGateEnabled = await askYN(
      rl,
      "Enable WriteGate? (blocks write tools for non-allowlisted users)",
      gateDefault,
    );

    // writeToolConfirmation
    const currentConfirm = existing.writeToolConfirmation;
    const confirmDefault = currentConfirm != null ? Boolean(currentConfirm) : false;
    const writeToolConfirmation = await askYN(
      rl,
      "Require interactive confirmation for write operations?",
      confirmDefault,
    );

    // writeToolAllowList
    const currentList = Array.isArray(existing.writeToolAllowList)
      ? (existing.writeToolAllowList as string[])
      : [];
    if (currentList.length > 0) {
      log.info(`Current allowlist: ${currentList.join(", ")}`);
    }
    const listInput = await ask(
      rl,
      `User IDs for writeToolAllowList (comma-separated${currentList.length > 0 ? ", leave empty to keep current" : ""}): `,
    );

    let writeToolAllowList: string[];
    if (listInput.trim() === "" && currentList.length > 0) {
      writeToolAllowList = currentList;
    } else {
      const newIds = listInput.split(",").map((s) => s.trim()).filter(Boolean);
      writeToolAllowList = [...new Set([...currentList, ...newIds])];
    }

    // Write
    const securityConfig = {
      writeGateEnabled,
      writeToolConfirmation,
      writeToolAllowList,
    };

    await updateYamlFileAtomic(configPath, (raw) => {
      const doc = (parseYaml(raw) ?? {}) as Record<string, unknown>;
      doc.security = { ...getSecuritySection(doc), ...securityConfig };
      return stringifyYaml(doc, { lineWidth: 120 });
    });

    log.info("");
    log.info("✅ Security configuration saved:");
    log.info(`  writeGateEnabled:      ${writeGateEnabled}`);
    log.info(`  writeToolConfirmation: ${writeToolConfirmation}`);
    log.info(`  writeToolAllowList:    ${writeToolAllowList.join(", ") || "(empty)"}`);
    log.info("");
    log.info("Restart OwliaBot to apply changes.");
  } finally {
    rl.close();
  }
}

/**
 * `owliabot security add-user <id>` — add user to writeToolAllowList
 */
export async function securityAddUser(userId: string): Promise<void> {
  const configPath = resolveConfigPath();

  await updateYamlFileAtomic(configPath, (raw) => {
    const doc = (parseYaml(raw) ?? {}) as Record<string, unknown>;
    const security = getSecuritySection(doc);
    const list = Array.isArray(security.writeToolAllowList)
      ? [...(security.writeToolAllowList as string[])]
      : [];

    if (list.includes(userId)) {
      log.info(`User ${userId} is already in writeToolAllowList.`);
      return raw; // no change
    }

    list.push(userId);
    security.writeToolAllowList = list;
    doc.security = security;
    return stringifyYaml(doc, { lineWidth: 120 });
  });

  log.info(`✅ Added ${userId} to writeToolAllowList.`);
  log.info("Restart OwliaBot to apply changes.");
}

/**
 * `owliabot security remove-user <id>` — remove user from writeToolAllowList
 */
export async function securityRemoveUser(userId: string): Promise<void> {
  const configPath = resolveConfigPath();

  await updateYamlFileAtomic(configPath, (raw) => {
    const doc = (parseYaml(raw) ?? {}) as Record<string, unknown>;
    const security = getSecuritySection(doc);
    const list = Array.isArray(security.writeToolAllowList)
      ? [...(security.writeToolAllowList as string[])]
      : [];

    const idx = list.indexOf(userId);
    if (idx < 0) {
      log.info(`User ${userId} is not in writeToolAllowList.`);
      return raw;
    }

    list.splice(idx, 1);
    security.writeToolAllowList = list;
    doc.security = security;
    return stringifyYaml(doc, { lineWidth: 120 });
  });

  log.info(`✅ Removed ${userId} from writeToolAllowList.`);
  log.info("Restart OwliaBot to apply changes.");
}
