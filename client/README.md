# Go Docker Onboarding (Centered TUI)

A standalone Go onboarding wizard for Docker deployments.

## Run

Preferred (through CLI entrypoint):

```bash
owliabot onboard
```

Source fallback (developer mode):

```bash
go -C client run .
```

Defaults:
- `config-dir`: `~/.owliabot`
- `output-dir`: current directory (`.`)

Optional overrides:

```bash
owliabot onboard --config-dir /custom/path --output-dir /custom/output
```

Smoke test:

```bash
bun tests/onboarding/smoke-onboard-go.mjs
```

## UX Style

- Centered popup card layout (does not occupy the full terminal canvas)
- English conversational copy with decision-first main area
- Main area: `Question + Key Context` (with `d` to expand/collapse Details)
- Option control: `↑/↓` select, `Enter` confirm, `Esc` back, mouse click, number shortcuts as fallback
- Key hint bar and option cards with short descriptions + recommendation badge
- Styles are defined via `lipgloss`-style API, with zone-based mouse hit targets
- Color accents + loading spinner during apply phase
- Docker preflight guidance (checks CLI installed + engine running before onboarding continues)
- Launch flow supports image update check and custom image tag/version input

Implementation note:
- `client/go.mod` maps `lipgloss` and `bubblezone` to local `third_party/` replacements so the TUI builds in offline Docker/bootstrap environments.

## Flow (aligned with TS `onboard --docker`)

1. Welcome
- Preflight checks:
  - Docker CLI installed
  - Docker engine running
  - Interactive guidance when prerequisites are missing
- Detect existing `secrets.yaml` + OAuth token files under `auth/`
- Offer reuse of existing credentials

2. Provider
- Anthropic / OpenAI / OpenAI Codex / OpenAI-compatible / Multiple
- Reuse path for existing Anthropic/OpenAI/Codex credentials

3. Channels
- Discord / Telegram / Both
- Token capture (or reuse)

4. Security
- Docker workspace confirmation (`/app/workspace`)
- Gateway host port, token, timezone
- Discord/Telegram allowlists
- Write-tool allowlist derivation from channel users (+ optional extra IDs)

5. Review
- Summary card with output paths and key settings

6. Apply
- Write `app.yaml`, `secrets.yaml`, `docker-compose.yml`
- Create `auth/` and `workspace/`
- Post-action menu:
  - Start container now
  - Start with custom image tag/version
  - Detect newer image digest and optionally pull before start

## Generated Files

- `~/.owliabot/app.yaml`
- `~/.owliabot/secrets.yaml`
- `~/.owliabot/auth/`
- `~/.owliabot/workspace/`
- `./docker-compose.yml` (or `--output-dir`)
