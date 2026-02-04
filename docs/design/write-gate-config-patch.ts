/**
 * Config schema additions for the write-tools permission gate.
 *
 * This file shows the exact changes needed in src/config/schema.ts
 * to support the new security configuration.
 */

import { z } from "zod";

// ── New schema to add ──────────────────────────────────────────────────────

/**
 * Security configuration for tool execution.
 * Add this near the top of schema.ts, before configSchema.
 */
export const securitySchema = z.object({
  /**
   * List of user IDs (Discord or Telegram) allowed to trigger write tools.
   * Empty array = all write tools disabled (safe default).
   *
   * Example: ["123456789012345678", "883499266"]
   *          (Discord snowflake)     (Telegram user ID)
   */
  writeToolAllowList: z.array(z.string()).default([]),

  /**
   * Whether to require interactive confirmation before executing write tools.
   * When true: bot sends a confirmation message and waits for user reply.
   * When false: allowlisted users can execute write tools without confirmation.
   * Default: true (safest option).
   */
  writeToolConfirmation: z.boolean().default(true),

  /**
   * Timeout in milliseconds for the confirmation prompt.
   * If the user doesn't reply within this window, the operation is auto-denied.
   * Default: 60000 (60 seconds).
   */
  writeToolConfirmationTimeoutMs: z.number().int().positive().default(60_000),
});

export type SecurityConfig = z.infer<typeof securitySchema>;

// ── Patch to configSchema ──────────────────────────────────────────────────

/**
 * Add the following field to the configSchema object in src/config/schema.ts:
 *
 * ```diff
 *  export const configSchema = z.object({
 *    // AI providers
 *    providers: z.array(providerSchema).min(1),
 *    // ...existing fields...
 *
 * +  // Security — write tool permission gate
 * +  security: securitySchema.optional(),
 * +
 *    // Gateway HTTP (optional)
 *    gateway: z.object({ ... }).optional(),
 *  });
 * ```
 *
 * Also add the import/definition of securitySchema above configSchema.
 */

// ── Example config.yaml usage ──────────────────────────────────────────────

/**
 * ```yaml
 * # config.yaml
 * security:
 *   writeToolAllowList:
 *     - "123456789012345678"   # Discord user ID (owner)
 *     - "883499266"            # Telegram user ID (owner)
 *   writeToolConfirmation: true
 *   writeToolConfirmationTimeoutMs: 60000
 * ```
 */

// ── Executor integration patch ─────────────────────────────────────────────

/**
 * Changes needed in src/agent/tools/executor.ts:
 *
 * 1. Import WriteGate:
 *    ```ts
 *    import { createWriteGate, type WriteGateChannel } from "../../write-gate.js";
 *    ```
 *
 * 2. Add WriteGateChannel + config to ExecutorOptions:
 *    ```ts
 *    export interface ExecutorOptions {
 *      registry: ToolRegistry;
 *      context: Omit<ToolContext, "requestConfirmation">;
 *      writeGateChannel?: WriteGateChannel;   // NEW
 *      securityConfig?: SecurityConfig;        // NEW
 *      workspacePath?: string;                 // NEW
 *    }
 *    ```
 *
 * 3. Replace the hard-coded write rejection in executeToolCall():
 *    ```ts
 *    // BEFORE:
 *    if (tool.security.level !== "read") {
 *      log.warn(`Tool ${call.name} requires ${tool.security.level} level, skipping`);
 *      return { success: false, error: `Tool ${call.name} requires confirmation (not implemented in MVP)` };
 *    }
 *
 *    // AFTER:
 *    if (tool.security.level !== "read") {
 *      if (!options.writeGateChannel || !options.workspacePath) {
 *        log.warn(`Tool ${call.name} requires write level but gate not configured, skipping`);
 *        return { success: false, error: `Write tools not configured` };
 *      }
 *      const gate = createWriteGate(options.securityConfig, options.writeGateChannel, options.workspacePath);
 *      const [channelId, userId] = context.sessionKey.split(":");
 *      const gateResult = await gate.check(call, {
 *        userId,
 *        sessionKey: context.sessionKey,
 *        target: context.sessionKey,
 *      });
 *      if (!gateResult.allowed) {
 *        return { success: false, error: `Write denied: ${gateResult.reason}` };
 *      }
 *    }
 *    ```
 *
 * 4. Implement WriteGateChannel adapter for Discord/Telegram:
 *    The adapter needs to:
 *    - sendMessage: Use the channel plugin's send() method
 *    - waitForReply: Register a one-time message listener filtered by userId,
 *      with a timeout. This can use a simple Promise + event emitter pattern.
 *
 *    Example for Discord:
 *    ```ts
 *    function createDiscordWriteGateChannel(
 *      discordPlugin: ChannelPlugin,
 *    ): WriteGateChannel {
 *      return {
 *        async sendMessage(target, msg) {
 *          await discordPlugin.send(target, msg);
 *        },
 *        async waitForReply(target, fromUserId, timeoutMs) {
 *          return new Promise<string | null>((resolve) => {
 *            const timeout = setTimeout(() => {
 *              cleanup();
 *              resolve(null);
 *            }, timeoutMs);
 *
 *            const handler = async (ctx: MsgContext) => {
 *              if (ctx.from === fromUserId) {
 *                cleanup();
 *                resolve(ctx.body);
 *              }
 *            };
 *
 *            const cleanup = () => {
 *              clearTimeout(timeout);
 *              // Remove the one-time handler
 *              // (requires ChannelPlugin to support removeHandler or similar)
 *            };
 *
 *            discordPlugin.onMessage(handler);
 *          });
 *        },
 *      };
 *    }
 *    ```
 */
