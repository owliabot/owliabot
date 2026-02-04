import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createLogger } from "../utils/logger.js";
import { parsePersonaFile } from "./frontmatter.js";
import type { PersonaDocument, PersonaDocumentKind } from "./types.js";

const log = createLogger("persona.loader");

const BASE_FILES: Array<{ name: string; kind: PersonaDocumentKind }> = [
  { name: "core.md", kind: "base-core" },
  { name: "style.md", kind: "base-style" },
  { name: "boundary.md", kind: "base-boundary" },
];

export interface PersonaLoaderOptions {
  rootDir?: string;
  personaDir?: string;
}

export interface PersonaLoadRequest {
  agentId: string;
  sessionId?: string;
}

export class PersonaLoader {
  private rootDir: string;
  private personaDir: string;

  constructor(options: PersonaLoaderOptions = {}) {
    this.rootDir = options.rootDir ?? process.cwd();
    this.personaDir = options.personaDir ?? "persona";
  }

  async load(request: PersonaLoadRequest): Promise<PersonaDocument[]> {
    const personaRoot = resolve(this.rootDir, this.personaDir);
    const baseDir = join(personaRoot, "base");
    const agentDir = join(personaRoot, "agents", request.agentId);
    const sessionDir = request.sessionId
      ? join(personaRoot, "session", request.sessionId)
      : null;

    const documents: PersonaDocument[] = [];

    for (const entry of BASE_FILES) {
      const doc = await this.readPersonaFile(join(baseDir, entry.name), entry.kind);
      if (doc) {
        documents.push(doc);
      }
    }

    const overlay = await this.readPersonaFile(join(agentDir, "overlay.md"), "overlay");
    if (overlay) {
      documents.push(overlay);
    }

    const notes = await this.readPersonaFile(join(agentDir, "notes.md"), "notes");
    if (notes) {
      documents.push(notes);
    }

    // Phase 2 placeholder: optional session mask (higher priority than overlay)
    if (sessionDir) {
      const mask = await this.readPersonaFile(join(sessionDir, "mask.md"), "mask");
      if (mask) {
        documents.push(mask);
      }
    }

    log.info(
      `Loaded ${documents.length} persona files for agent ${request.agentId}`
    );
    return documents;
  }

  private async readPersonaFile(
    path: string,
    kind: PersonaDocumentKind
  ): Promise<PersonaDocument | undefined> {
    try {
      const content = await readFile(path, "utf-8");
      const parsed = parsePersonaFile(content);
      return {
        kind,
        path,
        frontmatter: parsed.frontmatter,
        body: parsed.body,
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw err;
    }
  }
}
