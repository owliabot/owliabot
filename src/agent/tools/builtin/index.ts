// src/agent/tools/builtin/index.ts

// Factory (preferred for new code)
export { createBuiltinTools, type BuiltinToolsOptions } from "./factory.js";

// Policy filtering
export { filterToolsByPolicy, type ToolPolicy } from "../policy.js";

// Individual tool exports (for special cases)
export { echoTool } from "./echo.js";
export { createHelpTool } from "./help.js";
export { createClearSessionTool, type ClearSessionToolOptions } from "./clear-session.js";
export { createMemorySearchTool, type MemorySearchToolOptions } from "./memory-search.js";
export { createMemoryGetTool, type MemoryGetToolOptions } from "./memory-get.js";
export { createListFilesTool, type ListFilesToolOptions } from "./list-files.js";
export { createEditFileTool, type EditFileToolOptions } from "./edit-file.js";
export { createCronTool, type CronToolDeps } from "./cron.js";

// File system tools (group:fs)
export { createReadFileTool } from "./read-file.js";
export { createWriteFileTool } from "./write-file.js";
export { createApplyPatchTool } from "./apply-patch.js";

// System action tools (wrapping src/system/actions/*)
export { createExecTool, type ExecToolDeps } from "./exec.js";
export { createWebFetchTool, type WebFetchToolDeps } from "./web-fetch.js";
export { createWebSearchTool, type WebSearchToolDeps } from "./web-search.js";

// System action tools (wrapping src/system/actions/*)
export { createExecTool, type ExecToolDeps } from "./exec.js";
export { createWebFetchTool, type WebFetchToolDeps } from "./web-fetch.js";
export { createWebSearchTool, type WebSearchToolDeps } from "./web-search.js";
