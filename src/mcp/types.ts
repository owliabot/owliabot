/**
 * MCP Protocol Type Definitions
 * @see https://modelcontextprotocol.io/specification/2024-11-05
 */

import { z } from "zod";

// ============================================================================
// JSON-RPC 2.0 Base Types
// ============================================================================

export interface JSONRPCRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: Record<string, unknown>;
  error?: JSONRPCError;
}

export interface JSONRPCError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JSONRPCNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

export type JSONRPCMessage = JSONRPCRequest | JSONRPCResponse | JSONRPCNotification;

// ============================================================================
// MCP Protocol Types
// ============================================================================

/** MCP protocol version */
export const MCP_PROTOCOL_VERSION = "2024-11-05";

/** Client capabilities sent during initialize */
export interface ClientCapabilities {
  roots?: {
    listChanged?: boolean;
  };
  sampling?: Record<string, unknown>;
  experimental?: Record<string, unknown>;
}

/** Server capabilities received from initialize */
export interface ServerCapabilities {
  tools?: {
    listChanged?: boolean;
  };
  resources?: {
    subscribe?: boolean;
    listChanged?: boolean;
  };
  prompts?: {
    listChanged?: boolean;
  };
  logging?: Record<string, unknown>;
  experimental?: Record<string, unknown>;
}

/** Client info sent during initialize */
export interface ClientInfo {
  name: string;
  version: string;
}

/** Server info received from initialize */
export interface ServerInfo {
  name: string;
  version: string;
}

/** Initialize request params */
export interface InitializeParams {
  protocolVersion: string;
  capabilities: ClientCapabilities;
  clientInfo: ClientInfo;
}

/** Initialize response result */
export interface InitializeResult {
  protocolVersion: string;
  capabilities: ServerCapabilities;
  serverInfo: ServerInfo;
}

// ============================================================================
// MCP Tool Types
// ============================================================================

/** JSON Schema for tool input */
export interface MCPToolInputSchema {
  type: "object";
  properties?: Record<string, MCPSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

/** JSON Schema property definition */
export interface MCPSchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: MCPSchemaProperty;
  properties?: Record<string, MCPSchemaProperty>;
  required?: string[];
  default?: unknown;
}

/** MCP tool definition from tools/list */
export interface MCPToolDefinition {
  name: string;
  description?: string;
  inputSchema: MCPToolInputSchema;
}

/** tools/list response */
export interface ToolsListResult {
  tools: MCPToolDefinition[];
  nextCursor?: string;
}

/** tools/call params */
export interface ToolCallParams {
  name: string;
  arguments?: Record<string, unknown>;
}

/** Content types in tool result */
export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export interface ResourceContent {
  type: "resource";
  resource: {
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  };
}

export type ToolResultContent = TextContent | ImageContent | ResourceContent;

/** tools/call response */
export interface ToolCallResult {
  content: ToolResultContent[];
  isError?: boolean;
}

// ============================================================================
// Configuration Types
// ============================================================================

/** MCP server configuration schema */
export const mcpServerConfigSchema = z.object({
  name: z.string().min(1),
  command: z.string().optional(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).optional(),
  url: z.string().url().optional(),
  transport: z.enum(["stdio", "sse"]).default("stdio"),
  cwd: z.string().optional(),
});

export type MCPServerConfig = z.infer<typeof mcpServerConfigSchema>;

/** Security override for specific tools */
export const mcpSecurityOverrideSchema = z.object({
  level: z.enum(["read", "write", "sign"]),
  confirmRequired: z.boolean().optional(),
});

export type MCPSecurityOverride = z.infer<typeof mcpSecurityOverrideSchema>;

/** Default settings */
export const mcpDefaultsSchema = z.object({
  timeout: z.number().default(30000),
  connectTimeout: z.number().default(10000),
  restartOnCrash: z.boolean().default(true),
  maxRestarts: z.number().default(3),
  restartDelay: z.number().default(1000),
});

export type MCPDefaults = z.infer<typeof mcpDefaultsSchema>;

/** Full MCP configuration */
export const mcpConfigSchema = z.object({
  servers: z.array(mcpServerConfigSchema).default([]),
  securityOverrides: z.record(mcpSecurityOverrideSchema).optional(),
  defaults: mcpDefaultsSchema.optional(),
});

export type MCPConfig = z.infer<typeof mcpConfigSchema>;

// ============================================================================
// Error Types
// ============================================================================

export enum MCPErrorCode {
  CONNECTION_FAILED = "CONNECTION_FAILED",
  CONNECTION_LOST = "CONNECTION_LOST",
  INITIALIZATION_FAILED = "INITIALIZATION_FAILED",
  TIMEOUT = "TIMEOUT",
  INVALID_RESPONSE = "INVALID_RESPONSE",
  TOOL_NOT_FOUND = "TOOL_NOT_FOUND",
  TOOL_EXECUTION_FAILED = "TOOL_EXECUTION_FAILED",
  PROTOCOL_ERROR = "PROTOCOL_ERROR",
  SERVER_SPAWN_FAILED = "SERVER_SPAWN_FAILED",
}

export class MCPError extends Error {
  constructor(
    message: string,
    public code: MCPErrorCode,
    public details?: unknown
  ) {
    super(message);
    this.name = "MCPError";
  }
}

// ============================================================================
// Standard JSON-RPC Error Codes
// ============================================================================

export const JSONRPC_ERROR = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;
