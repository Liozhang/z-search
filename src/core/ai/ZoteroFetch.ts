import { ZSEARCH_HTTP_HEADERS } from "../../utils/httpHeaders";

/**
 * Zotero-compatible fetch implementation
 * Adapts Zotero.HTTP.request to fetch API for Vercel AI SDK
 */
export class ZoteroFetch {
  async fetch(url: string, options: RequestInit = {}): Promise<Response> {
    const method = options.method || "GET";
    let headers = (options.headers as Record<string, string>) || {};

    // Inject Leadero plugin identity headers for server-side tracking
    headers = {
      ...headers,
      ...ZSEARCH_HTTP_HEADERS,
    };

    const body = options.body as string | undefined;

    try {
      // Use Zotero.HTTP.request for non-streaming requests
      const response = await Zotero.HTTP.request(method as any, url, {
        headers,
        body,
        responseType: "text",
        timeout: 60000,
      });

      // Create a Response-like object using response headers (not request headers)
      const responseHeaders: Record<string, string> = {};
      if ((response as any).responseHeaders) {
        // Zotero.HTTP.request returns responseHeaders as a string like "key: value\nkey2: value2"
        const headerStr = (response as any).responseHeaders as string;
        for (const line of headerStr.split("\n")) {
          const idx = line.indexOf(":");
          if (idx > 0) {
            responseHeaders[line.slice(0, idx).trim().toLowerCase()] = line
              .slice(idx + 1)
              .trim();
          }
        }
      }

      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status || 200,
        statusText: response.statusText || "OK",
        headers: {
          get: (name: string) => responseHeaders[name.toLowerCase()],
          has: (name: string) => name.toLowerCase() in responseHeaders,
          forEach: (callback: (value: string, name: string) => void) => {
            for (const [key, value] of Object.entries(responseHeaders)) {
              callback(value, key);
            }
          },
          // Vercel AI SDK iterates headers (for..of / spread / .entries()).
          // The plain mock above only had get/has/forEach → "response.headers
          // is not iterable" on non-streaming requests (e.g. deep research).
          // Provide the full Headers iteration surface.
          entries: () => Object.entries(responseHeaders)[Symbol.iterator](),
          keys: () => Object.keys(responseHeaders)[Symbol.iterator](),
          values: () => Object.values(responseHeaders)[Symbol.iterator](),
          getSetCookie: () => [],
          [Symbol.iterator]: function* () {
            for (const [key, value] of Object.entries(responseHeaders)) {
              yield [key, value];
            }
          },
        } as unknown as Headers,
        async text() {
          return (response.response as string) || "";
        },
        async json() {
          return JSON.parse((response.response as string) || "{}");
        },
      } as Response;
    } catch (error: any) {
      const httpErr = new Error(
        `Zotero HTTP request failed: ${error.message}`,
      ) as Error & {
        statusCode?: number;
        responseBody?: string;
      };
      if (error.status != null) httpErr.statusCode = error.status;
      if (error.responseText) httpErr.responseBody = error.responseText;
      else if (error.xmlhttp?.responseText)
        httpErr.responseBody = error.xmlhttp.responseText;
      throw httpErr;
    }
  }
}
