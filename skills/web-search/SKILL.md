---
name: web-search
description: Search the web and fetch page content using built-in tools.
version: 1.0.0
---

# Web Search

Use the built-in `web_search` and `web_fetch` tools for web research.

## Searching

Use `web_search` with a query string:

- `query`: Search terms (required)
- `count`: Number of results (1-10, default 5)
- `country`: 2-letter country code for localized results (e.g., "US", "DE")
- `freshness`: Filter by time ("pd" = past day, "pw" = past week, "pm" = past month)

Returns titles, URLs, and snippets.

## Fetching Pages

Use `web_fetch` to extract content from a URL:

- `url`: The page URL (required)
- `extractMode`: "markdown" (default) or "text"
- `maxChars`: Truncate long pages

Returns readable content without HTML clutter.

## Workflow

1. Search for relevant pages
2. Pick the most promising URLs from results
3. Fetch and read the content
4. Synthesize information for the user

## Tips

- Use specific search terms for better results
- Fetch multiple sources for verification
- Summarize rather than dumping raw content
- Cite sources when providing information
