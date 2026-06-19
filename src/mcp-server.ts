#!/usr/bin/env node
/**
 * ScrapeAPI MCP Server
 * Exposes scraping tools to Claude and other MCP-compatible LLMs.
 * Run: node mcp-server.js
 * Or via npx: npx -y @scrapeapi/mcp
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

const API_BASE = process.env.SCRAPEAPI_BASE_URL ?? "https://getscrapeapi.com";
const API_KEY = process.env.SCRAPEAPI_KEY ?? "";

if (!API_KEY) {
  console.error("[ScrapeAPI MCP] Warning: SCRAPEAPI_KEY env var not set.");
}

// ── Tool definitions ────────────────────────────────────────────────────────

const TOOLS: Tool[] = [
  {
    name: "scrape_url",
    description:
      "Scrape any public URL and return structured data: text, links, images, and metadata. " +
      "Automatically detects whether JavaScript rendering is needed. " +
      "Use this when you need to read the content of a webpage.",
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: {
          type: "string",
          description: "The full URL to scrape (must include https://)",
        },
        extract_text: {
          type: "boolean",
          default: true,
          description: "Return the visible text content of the page",
        },
        extract_links: {
          type: "boolean",
          default: false,
          description: "Return all href links found on the page",
        },
        extract_images: {
          type: "boolean",
          default: false,
          description: "Return all image URLs found on the page",
        },
        extract_metadata: {
          type: "boolean",
          default: true,
          description: "Return page title, description, and Open Graph tags",
        },
        javascript: {
          type: "boolean",
          default: false,
          description:
            "Force JavaScript rendering via headless browser. Use for SPAs or pages that require JS to load content.",
        },
        proxy_country: {
          type: "string",
          description:
            "ISO 3166-1 alpha-2 country code to geo-target the scrape (e.g. US, GB, KE, DE)",
        },
        wait_for: {
          type: "string",
          description:
            "CSS selector to wait for before extracting content. Useful for lazy-loaded content.",
        },
        timeout: {
          type: "number",
          default: 30000,
          description: "Request timeout in milliseconds (1000–60000)",
        },
      },
    },
  },
  {
    name: "scrape_multiple",
    description:
      "Scrape multiple URLs in parallel and return results for each. " +
      "Use when you need to compare or aggregate data from several pages.",
    inputSchema: {
      type: "object",
      required: ["urls"],
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
          maxItems: 10,
          description: "List of URLs to scrape (max 10)",
        },
        extract_text: { type: "boolean", default: true },
        extract_links: { type: "boolean", default: false },
        extract_metadata: { type: "boolean", default: true },
        javascript: { type: "boolean", default: false },
      },
    },
  },
  {
    name: "extract_structured",
    description:
      "Scrape a URL and extract specific fields using CSS selectors. " +
      "Use when you need structured data from a known page layout " +
      "(e.g. product price, article title, table data).",
    inputSchema: {
      type: "object",
      required: ["url", "fields"],
      properties: {
        url: {
          type: "string",
          description: "The URL to scrape",
        },
        fields: {
          type: "array",
          description: "List of fields to extract using CSS selectors",
          items: {
            type: "object",
            required: ["name", "selector"],
            properties: {
              name: {
                type: "string",
                description: "Key name for this field in the result",
              },
              selector: {
                type: "string",
                description: "CSS selector to find the element",
              },
              attribute: {
                type: "string",
                description:
                  "HTML attribute to extract (e.g. href, src, content). Omit to get text content.",
              },
            },
          },
        },
        javascript: { type: "boolean", default: false },
      },
    },
  },
  {
    name: "take_screenshot",
    description:
      "Take a full-page screenshot of a URL and return it as a base64-encoded PNG. " +
      "Use for visual verification, capturing charts, or archiving page appearances.",
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: {
          type: "string",
          description: "The URL to screenshot",
        },
        wait_for: {
          type: "string",
          description: "CSS selector to wait for before taking the screenshot",
        },
        timeout: {
          type: "number",
          default: 30000,
        },
      },
    },
  },
  {
    name: "check_credits",
    description:
      "Check the remaining scrape credits on the current API key. " +
      "Use before running large scraping jobs to confirm sufficient balance.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_datasets",
    description:
      "List all available pre-built datasets. " +
      "Use when the user wants ready-made data without scraping (jobs, real estate, prices, VC funding, etc.)",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description:
            "Filter by category: Jobs & Labor, E-Commerce, Real Estate, Finance & VC, Social & Media",
        },
      },
    },
  },
];

// ── API helpers ─────────────────────────────────────────────────────────────

async function apiRequest(path: string, body?: object): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error ?? `API error: ${res.status}`);
  }
  return data;
}

function formatScrapeResult(data: any, meta: any): string {
  const lines: string[] = [];

  if (meta?.billing) {
    lines.push(`Credits used: ${meta.billing.creditsUsed} (${meta.billing.tier} tier)`);
    lines.push(`Credits remaining: ${meta.billing.creditsRemaining}`);
    lines.push("");
  }

  if (data.metadata?.title) lines.push(`Title: ${data.metadata.title}`);
  if (data.metadata?.description) lines.push(`Description: ${data.metadata.description}`);
  if (data.status) lines.push(`HTTP Status: ${data.status}`);
  lines.push("");

  if (data.text) {
    lines.push("--- PAGE TEXT ---");
    lines.push(data.text.slice(0, 8000));
    if (data.text.length > 8000) lines.push(`\n[...truncated, ${data.text.length} chars total]`);
    lines.push("");
  }

  if (data.links?.length) {
    lines.push(`--- LINKS (${data.links.length}) ---`);
    data.links.slice(0, 30).forEach((l: string) => lines.push(l));
    if (data.links.length > 30) lines.push(`...and ${data.links.length - 30} more`);
    lines.push("");
  }

  if (data.images?.length) {
    lines.push(`--- IMAGES (${data.images.length}) ---`);
    data.images.slice(0, 20).forEach((i: string) => lines.push(i));
    lines.push("");
  }

  if (data.custom && Object.keys(data.custom).length) {
    lines.push("--- EXTRACTED FIELDS ---");
    Object.entries(data.custom).forEach(([k, v]) => lines.push(`${k}: ${v}`));
    lines.push("");
  }

  return lines.join("\n");
}

// ── Tool handlers ────────────────────────────────────────────────────────────

async function handleScrapeUrl(args: any) {
  const body: any = {
    url: args.url,
    method: args.javascript ? "headless" : "http",
    javascript: args.javascript ?? false,
    screenshot: false,
    timeout: args.timeout ?? 30000,
    extract: {
      text: args.extract_text ?? true,
      links: args.extract_links ?? false,
      images: args.extract_images ?? false,
      metadata: args.extract_metadata ?? true,
      html: false,
    },
  };

  if (args.proxy_country) {
    body.proxy = { enabled: true, country: args.proxy_country };
  }
  if (args.wait_for) {
    body.waitFor = args.wait_for;
  }

  const result = await apiRequest("/api/scrape", body);
  return formatScrapeResult(result.data, result.meta);
}

async function handleScrapeMultiple(args: any) {
  const urls: string[] = args.urls;
  const results = await Promise.allSettled(
    urls.map(url =>
      apiRequest("/api/scrape", {
        url,
        method: args.javascript ? "headless" : "http",
        javascript: args.javascript ?? false,
        extract: {
          text: args.extract_text ?? true,
          links: args.extract_links ?? false,
          metadata: args.extract_metadata ?? true,
          html: false,
        },
      })
    )
  );

  return results
    .map((r, i) => {
      const url = urls[i];
      if (r.status === "rejected") return `## ${url}\nError: ${r.reason?.message}\n`;
      return `## ${url}\n${formatScrapeResult(r.value.data, r.value.meta)}\n---\n`;
    })
    .join("\n");
}

async function handleExtractStructured(args: any) {
  const result = await apiRequest("/api/scrape", {
    url: args.url,
    method: args.javascript ? "headless" : "http",
    javascript: args.javascript ?? false,
    extract: {
      html: false,
      text: false,
      metadata: false,
      json: args.fields,
    },
  });

  const lines = [`Extracted fields from: ${args.url}`, ""];
  if (result.data.custom) {
    Object.entries(result.data.custom).forEach(([k, v]) => {
      lines.push(`${k}: ${v}`);
    });
  }
  if (result.meta?.billing) {
    lines.push(`\nCredits used: ${result.meta.billing.creditsUsed}`);
  }
  return lines.join("\n");
}

async function handleScreenshot(args: any) {
  const result = await apiRequest("/api/scrape", {
    url: args.url,
    method: "headless",
    javascript: true,
    screenshot: true,
    waitFor: args.wait_for,
    timeout: args.timeout ?? 30000,
    extract: { text: false, metadata: true, html: false },
  });

  const lines = [
    `Screenshot captured: ${args.url}`,
    `Status: ${result.data.status}`,
  ];
  if (result.data.metadata?.title) lines.push(`Title: ${result.data.metadata.title}`);
  if (result.meta?.billing) lines.push(`Credits used: ${result.meta.billing.creditsUsed}`);
  if (result.data.screenshotUrl) {
    lines.push(`\nScreenshot (base64 PNG):\n${result.data.screenshotUrl.slice(0, 200)}...`);
  }
  return lines.join("\n");
}

async function handleCheckCredits() {
  try {
    const result = await apiRequest("/api/user");
    return `Credits remaining: ${result.data.creditsRemaining}\nPlan: ${result.data.plan}`;
  } catch {
    return "Could not fetch credit balance. Check your API key.";
  }
}

async function handleListDatasets(args: any) {
  const datasets = [
    { name: "US Tech Job Postings", category: "Jobs & Labor", records: "48,200", credits: 50, updated: "3 hours ago", format: "JSON" },
    { name: "E-Commerce Price Index", category: "E-Commerce", records: "312,000", credits: 100, updated: "6 hours ago", format: "CSV" },
    { name: "Global Real Estate Listings", category: "Real Estate", records: "89,500", credits: 75, updated: "12 hours ago", format: "JSON" },
    { name: "Startup Funding Rounds", category: "Finance & VC", records: "15,600", credits: 40, updated: "1 day ago", format: "JSON" },
    { name: "Trending Topics & Hashtags", category: "Social & Media", records: "9,800", credits: 25, updated: "1 hour ago", format: "CSV" },
    { name: "Amazon Product Reviews", category: "E-Commerce", records: "2,100,000", credits: 150, updated: "2 days ago", format: "JSON" },
  ];

  const filtered = args.category
    ? datasets.filter(d => d.category.toLowerCase().includes(args.category.toLowerCase()))
    : datasets;

  const lines = ["Available ScrapeAPI Datasets:", ""];
  filtered.forEach(d => {
    lines.push(`## ${d.name}`);
    lines.push(`Category: ${d.category}`);
    lines.push(`Records: ${d.records}`);
    lines.push(`Cost: ${d.credits} credits`);
    lines.push(`Updated: ${d.updated}`);
    lines.push(`Format: ${d.format}`);
    lines.push("");
  });

  lines.push(`Visit https://getscrapeapi.com/datasets to download.`);
  return lines.join("\n");
}

// ── Server setup ─────────────────────────────────────────────────────────────

const server = new Server(
  { name: "scrapeapi", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: string;

    switch (name) {
      case "scrape_url":         result = await handleScrapeUrl(args); break;
      case "scrape_multiple":    result = await handleScrapeMultiple(args); break;
      case "extract_structured": result = await handleExtractStructured(args); break;
      case "take_screenshot":    result = await handleScreenshot(args); break;
      case "check_credits":      result = await handleCheckCredits(); break;
      case "list_datasets":      result = await handleListDatasets(args); break;
      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }

    return { content: [{ type: "text", text: result }] };
  } catch (err: any) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[ScrapeAPI MCP] Server running on stdio");
}

main().catch(err => {
  console.error("[ScrapeAPI MCP] Fatal:", err);
  process.exit(1);
});
