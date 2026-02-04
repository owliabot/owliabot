export type PersonaTone = string[];

export interface PersonaFrontmatter {
  schemaVersion?: string;
  id?: string;
  name?: string;
  role?: string;
  mission?: string;
  tone?: PersonaTone;
  do?: string[];
  dont?: string[];
  boundaries?: string[];
  tools?: string[];
  memoryPolicy?: string;
  notes?: string[];
}

export type PersonaDocumentKind =
  | "base-core"
  | "base-style"
  | "base-boundary"
  | "overlay"
  | "notes"
  | "mask"
  | "memory";

export type PersonaDocumentSource = "base" | "overlay" | "memory";

export interface PersonaDocument {
  kind: PersonaDocumentKind;
  path: string;
  source: PersonaDocumentSource;
  readonly: boolean;
  frontmatter: PersonaFrontmatter;
  body: string;
}

export interface PersonaProfile extends PersonaFrontmatter {
  content?: string;
  sources: PersonaDocument[];
}

export interface PersonaPromptSection {
  title: string;
  content: string;
}
