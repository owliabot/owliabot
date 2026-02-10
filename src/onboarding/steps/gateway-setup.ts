/**
 * Step module: gateway configuration.
 */

import { createInterface } from "node:readline";
import { randomBytes } from "node:crypto";
import type { AppConfig } from "../types.js";
import type { SecretsConfig } from "../secrets.js";
import { info, success, header, ask, askYN } from "../shared.js";
import type { DetectedConfig, DockerGatewaySetup } from "./types.js";

export async function getGatewayConfig(
  rl: ReturnType<typeof createInterface>,
  dockerMode: boolean,
): Promise<AppConfig["gateway"] | undefined> {
  if (dockerMode) {
    return {
      http: { host: "0.0.0.0", port: 8787, token: "secrets" },
    };
  }

  header("Gateway HTTP (optional)");
  info("This gives you a small HTTP API for health checks and integrations.");

  const enableGateway = await askYN(rl, "Do you want to enable the Gateway HTTP API?", false);
  if (!enableGateway) return undefined;

  const port = parseInt(await ask(rl, "Port [8787]: ") || "8787", 10);
  const token = randomBytes(16).toString("hex");
  info(`I generated a gateway token: ${token.slice(0, 8)}...`);

  success(`Gateway HTTP enabled on port ${port}`);
  return { http: { host: "127.0.0.1", port, token } };
}

export async function configureDockerGatewayAndTimezone(
  rl: ReturnType<typeof createInterface>,
  existing: DetectedConfig | null,
  reuseExisting: boolean,
  secrets: SecretsConfig,
): Promise<DockerGatewaySetup> {
  header("Gateway HTTP");
  info("This is used for health checks and HTTP API access.");

  const gatewayPort = await ask(rl, "Host port to expose the gateway [8787]: ") || "8787";

  let gatewayToken = reuseExisting && existing?.gatewayToken ? existing.gatewayToken : "";
  if (!gatewayToken) {
    gatewayToken = randomBytes(16).toString("hex");
    info("I generated a random gateway token.");
  } else {
    success("Reusing your existing gateway token");
  }

  const confirmToken = await ask(rl, `Gateway token [${gatewayToken.slice(0, 8)}...]: `, true);
  if (confirmToken) gatewayToken = confirmToken;
  success("Gateway token saved");

  secrets.gateway = { token: gatewayToken };

  header("Other settings");
  const tz = await ask(rl, "Timezone [UTC]: ") || "UTC";
  success(`Timezone: ${tz}`);

  return { gatewayToken, gatewayPort, tz };
}
