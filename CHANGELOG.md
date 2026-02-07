# Changelog

All notable changes to OwliaBot will be documented in this file.

## [Unreleased]

## [0.2.0] - 2026-02-07

### Added
- **Skills System MVP** - Extensible tool system via JavaScript modules
  - `src/skills/` - Skill loader, context factory, and registry
  - Skills directory: `workspace/skills/`
  - Namespace format: `skill-name:tool-name`
  - Context injection: `fetch`, `env`, `meta`
  - Example skills: `crypto-price`, `crypto-balance`
- Skills configuration in `config.yaml`:
  - `skills.enabled` (default: true)
  - `skills.directory` (default: workspace/skills)
- `list_files` tool - List directory contents in workspace
- `edit_file` tool - Edit files with precise text replacement (fuzzy matching, BOM handling, CRLF/LF normalization)
- System prompt now includes MEMORY.md and TOOLS.md content

### Fixed
- Workspace files (MEMORY.md, TOOLS.md) were loaded but not injected into system prompt

## [0.1.0] - 2026-01-26

### Added
- Initial project structure
- Telegram channel (grammy)
- Discord channel (discord.js)
- LLM runner with multi-provider failover (pi-ai)
- OAuth authentication flow
- Session management (file-based)
- Agentic loop with tool calling
- Cron service with heartbeat support
- Notification service
- Workspace loader (SOUL.md, IDENTITY.md, USER.md, HEARTBEAT.md, MEMORY.md, TOOLS.md)
- Built-in tools:
  - `echo` - Test tool
  - `help` - List available tools
  - `clear_session` - Clear conversation history
  - `memory_search` - Search memory files
  - `memory_get` - Read file contents

### Security
- 3-tier key security model designed (implementation pending)
- Workspace path isolation for all file tools
- Path traversal prevention (no `..` or absolute paths)
