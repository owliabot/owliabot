/**
 * Step module: workspace path setup.
 */

import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { info, success, header, ask } from "../shared.js";

export async function getWorkspacePath(
  rl: ReturnType<typeof createInterface>,
  dockerMode: boolean,
  appConfigPath: string,
): Promise<string> {
  header("Workspace");

  if (dockerMode) {
    const workspace = "/app/workspace";
    info("In Docker mode, we'll use the default workspace path inside the container.");
    success(`Workspace path: ${workspace}`);
    return workspace;
  }

  const defaultWorkspace = join(dirname(appConfigPath), "workspace");
  const workspace = (await ask(rl, `Where should OwliaBot keep its workspace? [${defaultWorkspace}]: `)) || defaultWorkspace;
  success(`Workspace path: ${workspace}`);
  return workspace;
}
