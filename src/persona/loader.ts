import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { createLogger } from "../utils/logger.js";
import { parsePersonaFile } from "./frontmatter.js";
import { MemoryFilter } from "./memory/filter.js";
import { MemoryInjector } from "./memory/injector.js";
import type {
  PersonaDocument,
  PersonaDocumentKind,
  PersonaDocumentSource,
} from "./types.js";

const log = createLogger("persona.loader");

const BASE_FILES: Array<{ name: string; kind: PersonaDocumentKind }> = [
  { name: "core.md", kind: "base-core" },
  { name: "style.md", kind: "base-style" },
  { name: "boundary.md", kind: "base-boundary" },
];

export interface PersonaLoaderOptions {
  rootDir?: string;
  personaDir?: string;
  enableMemoryInjection?: boolean;
}

export interface PersonaLoadRequest {
  agentId: string;
  sessionId?: string;
  overlayDir?: string;
}

export class PersonaLoader {
  private rootDir: string;
  private personaDir: string;
  private enableMemoryInjection: boolean;

  constructor(options: PersonaLoaderOptions = {}) {
    this.rootDir = options.rootDir ?? process.cwd();
    this.personaDir = options.personaDir ?? "persona";
    this.enableMemoryInjection = options.enableMemoryInjection ?? true;
  }

  async load(request: PersonaLoadRequest): Promise<PersonaDocument[]> {
    const [baseDocs, overlayDocs] = await Promise.all([
      this.loadBase(),
      this.loadOverlay(request),
    ]);
    const documents = [...baseDocs, ...overlayDocs];

    log.info(
      `Loaded ${documents.length} persona files for agent ${request.agentId}`
    );
    return documents;
  }

  async loadWithMemory(
    agentId: string,
    memoryDir: string,
    options: Omit<PersonaLoadRequest, "agentId"> = {}
  ): Promise<PersonaDocument[]> {
    const documents = await this.load({ agentId, ...options });
    if (!this.enableMemoryInjection) {
      return documents;
    }

    const memoryDoc = await this.buildMemoryDocument(memoryDir);
    if (memoryDoc) {
      documents.push(memoryDoc);
    }

    return documents;
  }

  async loadBase(): Promise<PersonaDocument[]> {
    const personaRoot = resolve(this.rootDir, this.personaDir);
    const baseDir = join(personaRoot, "base");
    const documents: PersonaDocument[] = [];

    for (const entry of BASE_FILES) {
      const doc = await this.readPersonaFile(
        join(baseDir, entry.name),
        entry.kind,
        "base"
      );
      if (doc) {
        documents.push(doc);
      }
    }

    return documents;
  }

  async loadOverlay(request: PersonaLoadRequest): Promise<PersonaDocument[]> {
    const personaRoot = resolve(this.rootDir, this.personaDir);
    const agentDir = resolveOverlayDir(
      personaRoot,
      request.agentId,
      request.overlayDir
    );
    const sessionDir = request.sessionId
      ? join(personaRoot, "session", request.sessionId)
      : null;

    const documents: PersonaDocument[] = [];

    const overlay = await this.readPersonaFile(
      join(agentDir, "overlay.md"),
      "overlay",
      "overlay"
    );
    if (overlay) {
      documents.push(overlay);
    }

    const notes = await this.readPersonaFile(
      join(agentDir, "notes.md"),
      "notes",
      "overlay"
    );
    if (notes) {
      documents.push(notes);
    }

    // Phase 2 placeholder: optional session mask (higher priority than overlay)
    if (sessionDir) {
      const mask = await this.readPersonaFile(
        join(sessionDir, "mask.md"),
        "mask",
        "overlay"
      );
      if (mask) {
        documents.push(mask);
      }
    }

    return documents;
  }

  isFromBase(doc: PersonaDocument): boolean {
    return doc.source === "base";
  }

  private async readPersonaFile(
    path: string,
    kind: PersonaDocumentKind,
    source: PersonaDocumentSource
  ): Promise<PersonaDocument | undefined> {
    try {
      const content = await readFile(path, "utf-8");
      const parsed = parsePersonaFile(content);
      return {
        kind,
        path,
        source,
        readonly: source === "base",
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

  private async buildMemoryDocument(
    memoryDir: string
  ): Promise<PersonaDocument | undefined> {
    const resolvedDir = isAbsolute(memoryDir)
      ? memoryDir
      : resolve(this.rootDir, memoryDir);

    const filter = new MemoryFilter();
    const entries = await filter.filterFromDirectory({
      memoryDir: resolvedDir,
      sourceRoot: this.rootDir,
    });

    const summary = new MemoryInjector().inject(entries);
    if (!summary) {
      return undefined;
    }

    return {
      kind: "memory",
      path: resolvedDir,
      source: "memory",
      readonly: true,
      frontmatter: {},
      body: summary,
    };
  }
}

function resolveOverlayDir(
  personaRoot: string,
  agentId: string,
  overlayDir?: string
): string {
  if (overlayDir) {
    return isAbsolute(overlayDir)
      ? overlayDir
      : resolve(personaRoot, overlayDir);
  }
  return join(personaRoot, "agents", agentId);
}
