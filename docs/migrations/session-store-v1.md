# Session Store v1 migration

Session v1 introduces a new storage layout:

- `sessions.json` (index): `sessionKey -> { sessionId, updatedAt, ...meta }`
- `transcripts/<sessionId>.jsonl` (conversation transcript)

This replaces the old `sessions/<key>.jsonl` format.

## Breaking changes

1. **DM scope is no longer per-sender**
   - DMs are bucketed by `config.session.mainKey` (default `main`).
   - This matches the typical single-user allowlist deployment.

2. **Group chat activation defaults to mention-only**
   - In groups, the bot responds only when explicitly mentioned (Discord) unless the channel is allowlisted.

## What happens to existing sessions?

v1 does not automatically migrate old `*.jsonl` session files.

Recommended approach:

- If you don’t care about old history: delete the old session files and let v1 recreate data.
- If you do care about history: copy the relevant parts into your workspace memory files manually.

### Cleanup example

If your sessions directory is `~/.owliabot/sessions`:

```bash
# Review first
ls -la ~/.owliabot/sessions

# Then remove old jsonl files (keep the new v1 files if already present)
rm -f ~/.owliabot/sessions/*.jsonl
```

After restart, v1 will populate `sessions.json` and `transcripts/` automatically.
