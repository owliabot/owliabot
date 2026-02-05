import { isAbsolute, join, relative, resolve } from "node:path";
import { PersonaLoader } from "./loader.js";
import { PersonaMerger, type PersonaMergerOptions } from "./merger.js";
import type { PersonaDocument, PersonaProfile } from "./types.js";

export interface AgentPersonaManagerOptions {
  rootDir?: string;
  personaDir?: string;
  mergeOptions?: PersonaMergerOptions;
}

export class AgentPersonaManager {
  private readonly rootDir: string;
  private readonly personaDir: string;
  private readonly personaRoot: string;
  private readonly agentsRoot: string;
  private readonly loader: PersonaLoader;
  private readonly merger: PersonaMerger;
  private baseCache: PersonaDocument[] | null = null;
  private overlayDirs = new Map<string, string>();

  constructor(options: AgentPersonaManagerOptions = {}) {
    this.rootDir = options.rootDir ?? process.cwd();
    this.personaDir = options.personaDir ?? "persona";
    this.personaRoot = resolve(this.rootDir, this.personaDir);
    this.agentsRoot = join(this.personaRoot, "agents");
    this.loader = new PersonaLoader({
      rootDir: this.rootDir,
      personaDir: this.personaDir,
    });
    this.merger = new PersonaMerger(options.mergeOptions);
  }

  setOverlayDir(agentId: string, overlayDir: string): void {
    const agentRoot = this.resolveAgentRoot(agentId);
    const resolvedOverlayDir = resolveOverlayDir(agentRoot, overlayDir);
    this.assertOverlayWithinAgent(agentId, agentRoot, resolvedOverlayDir);
    this.overlayDirs.set(agentId, resolvedOverlayDir);
  }

  getOverlayDir(agentId: string): string {
    const agentRoot = this.resolveAgentRoot(agentId);
    return this.overlayDirs.get(agentId) ?? agentRoot;
  }

  async loadBase(): Promise<PersonaDocument[]> {
    if (!this.baseCache) {
      this.baseCache = await this.loader.loadBase();
    }
    return [...this.baseCache];
  }

  async loadAgentOverlay(
    agentId: string,
    sessionId?: string
  ): Promise<PersonaDocument[]> {
    const agentRoot = this.resolveAgentRoot(agentId);
    const overlayDir = this.getOverlayDir(agentId);
    this.assertOverlayWithinAgent(agentId, agentRoot, overlayDir);

    const documents = await this.loader.loadOverlay({
      agentId,
      sessionId,
      overlayDir,
    });
    this.assertOverlayDocuments(agentId, agentRoot, documents);
    return documents;
  }

  async loadPersona(
    agentId: string,
    sessionId?: string
  ): Promise<PersonaProfile> {
    const [baseDocs, overlayDocs] = await Promise.all([
      this.loadBase(),
      this.loadAgentOverlay(agentId, sessionId),
    ]);
    return this.merger.merge([...baseDocs, ...overlayDocs]);
  }

  clearBaseCache(): void {
    this.baseCache = null;
  }

  private resolveAgentRoot(agentId: string): string {
    const agentRoot = resolve(this.agentsRoot, agentId);
    if (!isSubpath(agentRoot, this.agentsRoot)) {
      throw new Error(
        `Cross-agent persona reference blocked for ${agentId}: invalid agent path`
      );
    }
    return agentRoot;
  }

  private assertOverlayWithinAgent(
    agentId: string,
    agentRoot: string,
    overlayDir: string
  ): void {
    if (!isSubpath(overlayDir, agentRoot)) {
      throw new Error(
        `Cross-agent persona reference blocked for ${agentId}: overlay path escapes agent root`
      );
    }
  }

  private assertOverlayDocuments(
    agentId: string,
    agentRoot: string,
    documents: PersonaDocument[]
  ): void {
    for (const doc of documents) {
      if (doc.kind !== "overlay" && doc.kind !== "notes") {
        continue;
      }
      if (!isSubpath(doc.path, agentRoot)) {
        throw new Error(
          `Cross-agent persona reference blocked for ${agentId}: ${doc.path}`
        );
      }
    }
  }
}

function resolveOverlayDir(agentRoot: string, overlayDir: string): string {
  return isAbsolute(overlayDir) ? overlayDir : resolve(agentRoot, overlayDir);
}

function isSubpath(target: string, base: string): boolean {
  const rel = relative(base, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
