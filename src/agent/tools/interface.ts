/**
 * Tool definition interface
 * @see design.md Section 5.2
 *
 * Note: Wallet signing is delegated to Clawlet. Tools that need
 * signing should call Clawlet's HTTP API.
 */

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
  config: ToolConfig;
  requestConfirmation?: (req: ConfirmationRequest) => Promise<boolean>;
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
