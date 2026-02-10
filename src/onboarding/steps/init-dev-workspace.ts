/**
 * Step module: dev workspace initialization.
 */

import { success } from "../shared.js";
import { ensureWorkspaceInitialized } from "../../workspace/init.js";
import { maybeUpdateWorkspacePolicyAllowedUsers } from "./policy-allowed-users.js";

export async function initDevWorkspace(
  workspace: string,
  writeToolAllowList: string[] | null,
): Promise<void> {
  const workspaceInit = await ensureWorkspaceInitialized({ workspacePath: workspace });
  maybeUpdateWorkspacePolicyAllowedUsers(workspace, writeToolAllowList);
  if (workspaceInit.wroteBootstrap) {
    success("Created BOOTSTRAP.md for first-run setup");
  }
  if (workspaceInit.copiedSkills && workspaceInit.skillsDir) {
    success(`Copied bundled skills to: ${workspaceInit.skillsDir}`);
  }
}
