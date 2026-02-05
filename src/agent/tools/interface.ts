/**
 * Tool definition interface
 * @see design.md Section 5.2
 */

import type { SignerInterface } from "../../signer/interface.js";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
  security: ToolSecurity;
  execute: (params: unknown, ctx: ToolContext) => Promise<ToolResult>;
}

export interface ToolSecurity {
  level: "read" | "write" | "sign";
  confirmRequired?: boolean;
  maxValue?: bigint;
  allowedContracts?: string[];
}

export interface ToolContext {
  sessionKey: string;
  agentId: string;
  signer: SignerInterface | null;
  config: ToolConfig;
  requestConfirmation?: (req: ConfirmationRequest) => Promise<boolean>;
  /** Optional: workspace path for skill execution */
  workspace?: string;
  /** Optional: callTool for skills (routed through ToolRouter) */
  callTool?: (name: string, args: unknown) => Promise<ToolResult>;
  /** Optional: callSigner for skills (routed through SignerRouter) */
  callSigner?: (operation: string, params: unknown) => Promise<ToolResult | unknown>;
}

export interface ToolConfig {
  [key: string]: unknown;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  // Added for pi-ai ToolResultMessage format
  toolCallId?: string;
  toolName?: string;
}

export interface ConfirmationRequest {
  type: "transaction" | "action";
  title: string;
  description: string;
  details?: Record<string, string>;
  transaction?: {
    to: string;
    value: bigint;
    data: string;
    chainId: number;
  };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

// JSON Schema type (simplified)
export interface JsonSchema {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
}

export interface JsonSchemaProperty {
  type: "string" | "number" | "boolean" | "array" | "object";
  description?: string;
  enum?: string[];
  items?: JsonSchemaProperty;
}
