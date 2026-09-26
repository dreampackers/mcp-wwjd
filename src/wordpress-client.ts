function toRequestBody(buffer: Buffer, contentType: string): Blob {
  return new Blob([Uint8Array.from(buffer)], { type: contentType });
}

export interface WordPressConfig {
  siteUrl: string;
  username: string;
  appPassword: string;
}

export class WordPressApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message);
    this.name = "WordPressApiError";
  }
}

/**
 * Thin wrapper around the WordPress REST API (wp/v2) authenticated with
 * an Application Password over HTTP Basic Auth.
 */
export class WordPressClient {
  private baseUrl: string;
  private authHeader: string;

  constructor(config: WordPressConfig) {
    this.baseUrl = config.siteUrl.replace(/\/+$/, "") + "/wp-json/wp/v2";
    const credentials = `${config.username}:${config.appPassword.replace(/\s+/g, "")}`;
    this.authHeader = "Basic " + Buffer.from(credentials, "utf-8").toString("base64");
  }

  private async request<T>(
    path: string,
    options: { method?: string; query?: Record<string, string | number | boolean | undefined>; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }

    const headers: Record<string, string> = {
      Authorization: this.authHeader,
    };

    let body: BodyInit | undefined;
    if (options.body !== undefined) {
      body = JSON.stringify(options.body);
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body,
    });

    const text = await response.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!response.ok) {
      const message =
        parsed && typeof parsed === "object" && "message" in (parsed as any)
          ? (parsed as any).message
          : `WordPress API request failed with status ${response.status}`;
      throw new WordPressApiError(message, response.status, parsed);
    }

    return parsed as T;
  }

  // ---- Posts ----

  listPosts(params: {
    search?: string;
    status?: string;
    perPage?: number;
    page?: number;
    categories?: number[];
    tags?: number[];
    orderby?: string;
    order?: "asc" | "desc";
  } = {}) {
    return this.request<any[]>("/posts", {
      query: {
        search: params.search,
        status: params.status,
        per_page: params.perPage ?? 10,
        page: params.page ?? 1,
        categories: params.categories?.join(","),
        tags: params.tags?.join(","),
        orderby: params.orderby,
        order: params.order,
        context: "edit",
      },
    });
  }

  getPost(id: number) {
    return this.request<any>(`/posts/${id}`, { query: { context: "edit" } });
  }

  createPost(data: {
    title: string;
    content: string;
    status?: string;
    excerpt?: string;
    slug?: string;
    categories?: number[];
    tags?: number[];
    featured_media?: number;
    date?: string;
    author?: number;
  }) {
    return this.request<any>("/posts", { method: "POST", body: data });
  }

  updatePost(
    id: number,
    data: Partial<{
      title: string;
      content: string;
      status: string;
      excerpt: string;
      slug: string;
      categories: number[];
      tags: number[];
      featured_media: number;
      date: string;
    }>,
  ) {
    return this.request<any>(`/posts/${id}`, { method: "POST", body: data });
  }

  deletePost(id: number, force = false) {
    return this.request<any>(`/posts/${id}`, { method: "DELETE", query: { force } });
  }

  // ---- Pages ----

  createPage(data: { title: string; content: string; status?: string; slug?: string; parent?: number }) {
    return this.request<any>("/pages", { method: "POST", body: data });
  }

  updatePage(id: number, data: Partial<{ title: string; content: string; status: string; slug: string; parent: number }>) {
    return this.request<any>(`/pages/${id}`, { method: "POST", body: data });
  }

  // ---- Media ----

  async uploadMediaFromUrl(imageUrl: string, filename?: string, altText?: string) {
    const res = await fetch(imageUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch image from URL: ${imageUrl} (status ${res.status})`);
    }
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    const buffer = Buffer.from(await res.arrayBuffer());
    const finalName = filename ?? this.filenameFromUrl(imageUrl, contentType);
    return this.uploadMediaBuffer(buffer, finalName, contentType, altText);
  }

  async uploadMediaFromBase64(base64Data: string, filename: string, mimeType: string, altText?: string) {
    const buffer = Buffer.from(base64Data, "base64");
    return this.uploadMediaBuffer(buffer, filename, mimeType, altText);
  }

  private async uploadMediaBuffer(buffer: Buffer, filename: string, contentType: string, altText?: string) {
    const url = new URL(this.baseUrl + "/media");
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: this.authHeader,
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
      },
      body: toRequestBody(buffer, contentType),
    });

    const text = await response.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!response.ok) {
      const message =
        parsed && typeof parsed === "object" && "message" in (parsed as any)
          ? (parsed as any).message
          : `Media upload failed with status ${response.status}`;
      throw new WordPressApiError(message, response.status, parsed);
    }

    const media = parsed as any;

    if (altText && media?.id) {
      return this.request<any>(`/media/${media.id}`, { method: "POST", body: { alt_text: altText } });
    }

    return media;
  }

  private filenameFromUrl(url: string, contentType: string): string {
    try {
      const pathname = new URL(url).pathname;
      const base = pathname.split("/").pop();
      if (base && base.includes(".")) return base;
    } catch {
      // ignore
    }
    const ext = contentType.split("/")[1]?.split("+")[0] ?? "jpg";
    return `upload-${Date.now()}.${ext}`;
  }

  // ---- Taxonomies ----

  listCategories(params: { search?: string; perPage?: number } = {}) {
    return this.request<any[]>("/categories", { query: { search: params.search, per_page: params.perPage ?? 100 } });
  }

  createCategory(name: string, parent?: number) {
    return this.request<any>("/categories", { method: "POST", body: { name, parent } });
  }

  listTags(params: { search?: string; perPage?: number } = {}) {
    return this.request<any[]>("/tags", { query: { search: params.search, per_page: params.perPage ?? 100 } });
  }

  createTag(name: string) {
    return this.request<any>("/tags", { method: "POST", body: { name } });
  }
}
