import { parse, stringify } from "yaml";

import { applyPrimaryModelRefOverride, type ProviderModelRef } from "./override.js";

/**
 * Update `providers[]` in an app.yaml string so the given model ref becomes the
 * primary provider (priority=1) and its model id is updated.
 *
 * Important: this parses the YAML as-is (no env expansion, no secrets merging),
 * to avoid accidentally writing resolved secrets back into app.yaml.
 */
export function updateAppConfigYamlPrimaryModel(yamlText: string, override: ProviderModelRef): string {
  const doc = parse(yamlText) as any;
  if (!doc || typeof doc !== "object") {
    throw new Error("Invalid YAML config: expected mapping at root");
  }

  if (!Array.isArray(doc.providers)) {
    throw new Error("Invalid YAML config: missing providers[]");
  }

  doc.providers = applyPrimaryModelRefOverride(doc.providers, override);
  return stringify(doc);
}

