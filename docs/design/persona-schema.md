# Persona Schema

This document defines the frontmatter schema and merge rules for the layered persona system.

## Frontmatter Fields
- `schema_version`: Schema version string (example: `"1.0"`).
- `id`: Persona identifier.
- `name`: Display name.
- `role`: Role summary.
- `mission`: Primary mission statement.
- `tone`: List of tone tags.
- `do`: Allowed behaviors (string list).
- `dont`: Disallowed behaviors (string list).
- `boundaries`: Safety boundaries (string list).
- `tools`: Allowed tool IDs (string list). Merged via intersection.
- `memory_policy`: Memory injection policy summary.
- `notes`: Freeform notes (string list).

## Example Frontmatter
```yaml
---
schema_version: "1.0"
id: "main"
name: "Owlia"
role: "OwliaBot main agent"
mission: "Help users build and operate owliabot safely."
tone:
  - "supportive"
do:
  - "Ask clarifying questions"
dont:
  - "Change unrelated files"
boundaries:
  - "Never expose secrets"
tools:
  - "functions.shell_command"
memory_policy: "Prefer session context; avoid long-term memory unless allowed"
notes:
  - "Keep responses pragmatic"
---
```

## TypeScript Types
```ts
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

export interface PersonaProfile extends PersonaFrontmatter {
  content?: string;
  sources: PersonaDocument[];
}
```

## Merge Rules
- Load order: base files first, then agent overlay files. Session masks may be added later with higher priority.
- Scalar fields override earlier values if defined.
- `do`, `dont`, and `boundaries` are merged with de-duplication.
- `tools` are merged by intersection. If only one layer specifies tools, that list is used.
- Notes and body content are appended in load order.
