#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { marked } from "marked";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { WordPressApiError, WordPressClient } from "./wordpress-client.js";

const SITE_URL = process.env.WP_SITE_URL;
const USERNAME = process.env.WP_USERNAME;
const APP_PASSWORD = process.env.WP_APP_PASSWORD;
const DEFAULT_STATUS = process.env.WP_DEFAULT_STATUS ?? "draft";

if (!SITE_URL || !USERNAME || !APP_PASSWORD) {
  console.error(
    "Missing WordPress configuration. Please set WP_SITE_URL, WP_USERNAME and WP_APP_PASSWORD environment variables.",
  );
  process.exit(1);
}

const wp = new WordPressClient({ siteUrl: SITE_URL, username: USERNAME, appPassword: APP_PASSWORD });

function toContentHtml(content: string, format: "markdown" | "html" | undefined): string {
  if (format === "html") return content;
  // Default to treating content as Markdown since that's how Claude typically writes long-form text.
  return marked.parse(content, { async: false }) as string;
}

function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(err: unknown) {
  if (err instanceof WordPressApiError) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `WordPress API error (status ${err.status}): ${err.message}\n${JSON.stringify(err.body, null, 2)}`,
        },
      ],
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: "text" as const, text: `Error: ${message}` }] };
}

const contentFormatSchema = z.enum(["markdown", "html"]).optional().describe(
  "Format of the `content` field. 'markdown' (default) is converted to HTML automatically; use 'html' if you already have WordPress-ready HTML.",
);

const tools = {
  wp_list_posts: {
    description: "List/search WordPress posts. Useful for finding an existing post before editing it.",
    inputSchema: z.object({
      search: z.string().optional().describe("Free-text search query"),
      status: z.string().optional().describe("Comma-separated statuses, e.g. 'draft,publish'"),
      per_page: z.number().int().min(1).max(100).optional(),
      page: z.number().int().min(1).optional(),
    }),
    handler: async (args: any) => {
      const posts = await wp.listPosts({ search: args.search, status: args.status, perPage: args.per_page, page: args.page });
      return jsonResult(
        posts.map((p) => ({ id: p.id, title: p.title?.rendered, status: p.status, link: p.link, date: p.date })),
      );
    },
  },

  wp_get_post: {
    description: "Get the full details of a WordPress post by ID, including raw content.",
    inputSchema: z.object({ id: z.number().int() }),
    handler: async (args: any) => {
      const post = await wp.getPost(args.id);
      return jsonResult({
        id: post.id,
        title: post.title?.raw ?? post.title?.rendered,
        content: post.content?.raw ?? post.content?.rendered,
        excerpt: post.excerpt?.raw ?? post.excerpt?.rendered,
        status: post.status,
        slug: post.slug,
        link: post.link,
        categories: post.categories,
        tags: post.tags,
        featured_media: post.featured_media,
        date: post.date,
      });
    },
  },

  wp_create_post: {
    description:
      "Create a new WordPress post. Content should be the full article body written in this conversation. " +
      "Defaults to creating a draft so you can review it in WordPress before publishing; pass status='publish' to publish immediately.",
    inputSchema: z.object({
      title: z.string().describe("Post title"),
      content: z.string().describe("Post body. Markdown by default (see content_format)."),
      content_format: contentFormatSchema,
      status: z.enum(["draft", "publish", "pending", "private"]).optional().describe(`Defaults to '${DEFAULT_STATUS}'`),
      excerpt: z.string().optional(),
      slug: z.string().optional(),
      category_names: z.array(z.string()).optional().describe("Category names; created automatically if they don't exist"),
      tag_names: z.array(z.string()).optional().describe("Tag names; created automatically if they don't exist"),
      featured_media_id: z.number().int().optional().describe("Media ID to use as the featured image (see wp_upload_media)"),
    }),
    handler: async (args: any) => {
      const [categories, tags] = await Promise.all([
        resolveCategoryIds(args.category_names),
        resolveTagIds(args.tag_names),
      ]);
      const post = await wp.createPost({
        title: args.title,
        content: toContentHtml(args.content, args.content_format),
        status: args.status ?? DEFAULT_STATUS,
        excerpt: args.excerpt,
        slug: args.slug,
        categories,
        tags,
        featured_media: args.featured_media_id,
      });
      return jsonResult({ id: post.id, status: post.status, link: post.link, edit_link: `${SITE_URL}/wp-admin/post.php?post=${post.id}&action=edit` });
    },
  },

  wp_update_post: {
    description: "Update an existing WordPress post (partial update — only send the fields you want changed).",
    inputSchema: z.object({
      id: z.number().int(),
      title: z.string().optional(),
      content: z.string().optional(),
      content_format: contentFormatSchema,
      status: z.enum(["draft", "publish", "pending", "private"]).optional(),
      excerpt: z.string().optional(),
      slug: z.string().optional(),
      category_names: z.array(z.string()).optional(),
      tag_names: z.array(z.string()).optional(),
      featured_media_id: z.number().int().optional(),
    }),
    handler: async (args: any) => {
      const [categories, tags] = await Promise.all([
        resolveCategoryIds(args.category_names),
        resolveTagIds(args.tag_names),
      ]);
      const post = await wp.updatePost(args.id, {
        title: args.title,
        content: args.content !== undefined ? toContentHtml(args.content, args.content_format) : undefined,
        status: args.status,
        excerpt: args.excerpt,
        slug: args.slug,
        categories,
        tags,
        featured_media: args.featured_media_id,
      });
      return jsonResult({ id: post.id, status: post.status, link: post.link });
    },
  },

  wp_delete_post: {
    description: "Move a post to trash (default) or permanently delete it (force=true).",
    inputSchema: z.object({ id: z.number().int(), force: z.boolean().optional() }),
    handler: async (args: any) => {
      const result = await wp.deletePost(args.id, args.force ?? false);
      return jsonResult({ deleted: true, id: args.id, forced: args.force ?? false, result });
    },
  },

  wp_upload_media: {
    description: "Upload an image to the WordPress media library from a public URL, returning a media ID you can use as a featured image or embed in post content.",
    inputSchema: z.object({
      image_url: z.string().url().describe("Publicly accessible URL of the image to download and upload"),
      filename: z.string().optional(),
      alt_text: z.string().optional(),
    }),
    handler: async (args: any) => {
      const media = await wp.uploadMediaFromUrl(args.image_url, args.filename, args.alt_text);
      return jsonResult({ id: media.id, source_url: media.source_url, link: media.link });
    },
  },

  wp_list_categories: {
    description: "List WordPress categories.",
    inputSchema: z.object({ search: z.string().optional() }),
    handler: async (args: any) => {
      const categories = await wp.listCategories({ search: args.search });
      return jsonResult(categories.map((c) => ({ id: c.id, name: c.name, count: c.count })));
    },
  },

  wp_list_tags: {
    description: "List WordPress tags.",
    inputSchema: z.object({ search: z.string().optional() }),
    handler: async (args: any) => {
      const tags = await wp.listTags({ search: args.search });
      return jsonResult(tags.map((t) => ({ id: t.id, name: t.name, count: t.count })));
    },
  },
};

async function resolveCategoryIds(names: string[] | undefined): Promise<number[] | undefined> {
  if (!names || names.length === 0) return undefined;
  const ids: number[] = [];
  for (const name of names) {
    const existing = await wp.listCategories({ search: name });
    const match = existing.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (match) {
      ids.push(match.id);
    } else {
      const created = await wp.createCategory(name);
      ids.push(created.id);
    }
  }
  return ids;
}

async function resolveTagIds(names: string[] | undefined): Promise<number[] | undefined> {
  if (!names || names.length === 0) return undefined;
  const ids: number[] = [];
  for (const name of names) {
    const existing = await wp.listTags({ search: name });
    const match = existing.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (match) {
      ids.push(match.id);
    } else {
      const created = await wp.createTag(name);
      ids.push(created.id);
    }
  }
  return ids;
}

const server = new Server(
  { name: "mcp-wwjd", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Object.entries(tools).map(([name, tool]) => ({
    name,
    description: tool.description,
    inputSchema: zodToJsonSchema(tool.inputSchema, { target: "jsonSchema7", $refStrategy: "none" }),
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = (tools as Record<string, (typeof tools)[keyof typeof tools]>)[request.params.name];
  if (!tool) {
    return { isError: true, content: [{ type: "text" as const, text: `Unknown tool: ${request.params.name}` }] };
  }
  try {
    const parsed = tool.inputSchema.parse(request.params.arguments ?? {});
    return await tool.handler(parsed);
  } catch (err) {
    return errorResult(err);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("mcp-wwjd (WordPress publishing MCP server) running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting mcp-wwjd:", err);
  process.exit(1);
});
