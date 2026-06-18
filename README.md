# ScrapeAPI MCP Server

Web scraping tools for Claude and other MCP-compatible LLM agents.

## Tools available

| Tool | Description |
|------|-------------|
| `scrape_url` | Scrape any URL and return text, links, images, metadata |
| `scrape_multiple` | Scrape up to 10 URLs in parallel |
| `extract_structured` | Extract specific fields using CSS selectors |
| `take_screenshot` | Full-page screenshot as base64 PNG |
| `check_credits` | Check remaining credit balance |
| `list_datasets` | Browse available pre-built datasets |

## Setup in Claude Desktop

1. Get your API key at **https://api.scrapeapi.dev**

2. Open your Claude Desktop config file:
   - **Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

3. Add this:

```json
{
  "mcpServers": {
    "scrapeapi": {
      "command": "npx",
      "args": ["-y", "@scrapeapi/mcp"],
      "env": {
        "SCRAPEAPI_KEY": "sk_your_api_key_here"
      }
    }
  }
}
```

4. Restart Claude Desktop

## Usage examples

Once connected, just ask Claude:

- *"Scrape https://example.com and summarize the content"*
- *"Extract all product prices from https://shop.example.com"*
- *"Take a screenshot of https://dashboard.example.com"*
- *"What datasets do you have available?"*

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SCRAPEAPI_KEY` | Yes | Your ScrapeAPI key |
| `SCRAPEAPI_BASE_URL` | No | Override API base URL |

## Links

- API Docs: https://api.scrapeapi.dev/docs
- Pricing: https://api.scrapeapi.dev/#pricing
- Support: hello@scrapeapi.dev
