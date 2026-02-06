import { loadConfig } from "../config/loader.js";
import { startGatewayHttp } from "./http/server.js";

const config = await loadConfig(process.argv[2] ?? "config.yaml");
if (!config.gateway?.http) {
  throw new Error("gateway.http config is required to start HTTP gateway");
}

await startGatewayHttp({
  config: config.gateway.http,
  workspacePath: config.workspace,
  system: config.system,
});
