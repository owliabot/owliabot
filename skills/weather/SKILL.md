---
name: weather
description: Get current weather and forecasts using wttr.in (no API key required).
version: 1.0.0
---

# Weather

Use wttr.in for weather queries. No API key needed.

## Quick Check

```bash
curl -s "wttr.in/London?format=3"
# Output: London: ⛅️ +8°C
```

## Detailed Format

```bash
curl -s "wttr.in/London?format=%l:+%c+%t+%h+%w"
# Output: London: ⛅️ +8°C 71% ↙5km/h
```

## Full Forecast

```bash
curl -s "wttr.in/London?T"
```

## Format Codes

| Code | Meaning |
|------|---------|
| `%c` | Condition (emoji) |
| `%t` | Temperature |
| `%h` | Humidity |
| `%w` | Wind |
| `%l` | Location |
| `%m` | Moon phase |

## Tips

- URL-encode spaces: `wttr.in/New+York`
- Airport codes work: `wttr.in/JFK`
- Units: `?m` (metric), `?u` (USCS)
- Today only: `?1`
- Current only: `?0`
- PNG output: `curl -s "wttr.in/Berlin.png" -o /tmp/weather.png`
