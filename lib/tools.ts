import { extractFromHtml } from "@extractus/article-extractor"
import fs from "fs/promises"
import path from "path"
import TurndownService from "turndown"
import { z } from "zod"
import { isPrivateUrl } from "@/lib/ssrf-protection"

/**
 * Get draw.io shape library documentation tool
 * Returns shape names and style syntax for a specific library
 */
export const getShapeLibraryTool = {
    description: `Get draw.io shape/icon library documentation with style syntax and shape names.

Available libraries:
- Cloud: aws4, azure2, gcp2, alibaba_cloud, openstack, salesforce
- Networking: cisco19, network, kubernetes, vvd, rack
- Business: bpmn, lean_mapping
- General: flowchart, basic, arrows2, infographic, sitemap
- UI/Mockups: android, material_design
- Enterprise: citrix, sap, mscae, atlassian
- Engineering: fluidpower, electrical, pid, cabinets, floorplan
- Icons: webicons

Call this tool to get shape names and usage syntax for a specific library.`,
    inputSchema: z.object({
        library: z
            .string()
            .describe("Library name (e.g., 'aws4', 'kubernetes', 'flowchart')"),
    }),
    execute: async ({ library }: { library: string }) => {
        // Sanitize input - prevent path traversal attacks
        const sanitizedLibrary = library
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, "")

        if (sanitizedLibrary !== library.toLowerCase()) {
            return `Invalid library name "${library}". Use only letters, numbers, underscores, and hyphens.`
        }

        const baseDir = path.join(process.cwd(), "docs/shape-libraries")
        const filePath = path.join(baseDir, `${sanitizedLibrary}.md`)

        // Verify path stays within expected directory
        const resolvedPath = path.resolve(filePath)
        if (!resolvedPath.startsWith(path.resolve(baseDir))) {
            return `Invalid library path.`
        }

        try {
            const content = await fs.readFile(filePath, "utf-8")
            return content
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                return `Library "${library}" not found. Available: aws4, azure2, gcp2, alibaba_cloud, cisco19, kubernetes, network, bpmn, flowchart, basic, arrows2, vvd, salesforce, citrix, sap, mscae, atlassian, fluidpower, electrical, pid, cabinets, floorplan, webicons, infographic, sitemap, android, material_design, lean_mapping, openstack, rack`
            }
            console.error(
                `[get_shape_library] Error loading "${library}":`,
                error,
            )
            return `Error loading library "${library}". Please try again.`
        }
    },
}

/**
 * Create Tavily web search tool
 * Returns a tool definition that uses the provided API key
 */
export const createWebSearchTool = (apiKey: string) => ({
    description: `Search the web for current information, facts, news, or documentation.

Use this when you need:
- Current/recent information not in your training data
- Real-time data (prices, statistics, news)
- Technical documentation or API references
- Verification of facts or claims

Returns: List of relevant web pages with titles, URLs, and content snippets.`,
    inputSchema: z.object({
        query: z
            .string()
            .describe("Search query (be specific for better results)"),
    }),
    execute: async ({ query }: { query: string }) => {
        try {
            const response = await fetch("https://api.tavily.com/search", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    api_key: apiKey,
                    query,
                    max_results: 5,
                    include_answer: true,
                }),
            })

            if (!response.ok) {
                throw new Error(`Tavily API error: ${response.status}`)
            }

            const data = await response.json()

            // Format results for AI
            const results = data.results
                .map(
                    (r: any, i: number) =>
                        `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content}\n`,
                )
                .join("\n")

            return {
                answer: data.answer || "",
                results,
                query,
            }
        } catch (error) {
            console.error("[web_search] Error:", error)
            return {
                error: error instanceof Error ? error.message : "Search failed",
            }
        }
    },
})

// Content extraction limits (match PDF/text upload limits)
const EXTRACT_MAX_CONTENT_LENGTH = 150000
const EXTRACT_TIMEOUT_MS = 15000
const EXTRACT_USER_AGENT =
    "Mozilla/5.0 (compatible; AutoDrawio/1.0; +https://github.com/aleck31/auto-draw-io)"

/**
 * Detect a page's charset so non-UTF-8 pages (Shift_JIS/GBK/EUC/Big5, common on
 * CJK sites) decode correctly. Falls back to UTF-8 on unknown labels.
 */
function detectCharset(
    contentType: string | null,
    buffer: ArrayBuffer,
): string {
    const headerCharset = contentType?.match(/charset=([^;]+)/i)?.[1]?.trim()
    const head = new TextDecoder("utf-8").decode(buffer.slice(0, 4096))
    const metaCharset =
        head.match(/<meta[^>]+charset=["']?\s*([\w-]+)/i)?.[1] ||
        head.match(/<meta[^>]+content=["'][^"']*charset=([\w-]+)/i)?.[1]
    const charset = (headerCharset || metaCharset || "utf-8").toLowerCase()
    try {
        new TextDecoder(charset)
        return charset
    } catch {
        return "utf-8"
    }
}

const turndownService = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
})

/**
 * Extract the main article content of a single URL as Markdown, locally
 * (no external API). SSRF-protected and charset-aware.
 */
async function extractUrlToMarkdown(url: string): Promise<string> {
    // SSRF: never fetch private/internal hosts.
    if (await isPrivateUrl(url)) {
        return `# ${url}\n\nError: Cannot access private/internal URLs.\n\n---\n`
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), EXTRACT_TIMEOUT_MS)
    try {
        // Fetch ourselves with redirect:"error" so a public URL cannot 302 to
        // an internal host and bypass the SSRF check above.
        const response = await fetch(url, {
            headers: { "User-Agent": EXTRACT_USER_AGENT },
            redirect: "error",
            signal: controller.signal,
        })

        const contentType = response.headers.get("content-type")
        if (contentType?.includes("application/pdf")) {
            return `# ${url}\n\nError: PDF URLs are not supported. Please download and upload the PDF file directly.\n\n---\n`
        }
        if (!response.ok) {
            return `# ${url}\n\nError: Could not fetch URL content (HTTP ${response.status}).\n\n---\n`
        }

        const buffer = await response.arrayBuffer()
        const charset = detectCharset(contentType, buffer)
        const html = new TextDecoder(charset).decode(buffer)

        // Extract main article, then convert to Markdown.
        const article = await extractFromHtml(html, url).catch(() => null)
        let contentHtml = article?.content

        // Fallback for non-article pages (index/listing/app pages) where the
        // article extractor finds no main content: strip scripts/nav/chrome
        // and convert the whole body so we still return usable text.
        if (!contentHtml) {
            const stripped = html
                .replace(/<script[\s\S]*?<\/script>/gi, "")
                .replace(/<style[\s\S]*?<\/style>/gi, "")
                .replace(/<(nav|header|footer|svg)[\s\S]*?<\/\1>/gi, "")
            const bodyMatch = stripped.match(/<body[\s\S]*<\/body>/i)
            contentHtml = bodyMatch ? bodyMatch[0] : stripped
        }

        if (!contentHtml) {
            return `# ${url}\n\nError: Could not extract readable content from this page.\n\n---\n`
        }

        let markdown = turndownService.turndown(contentHtml)
        if (markdown.length > EXTRACT_MAX_CONTENT_LENGTH) {
            markdown = `${markdown.slice(0, EXTRACT_MAX_CONTENT_LENGTH)}\n\n[content truncated]`
        }
        const title = article?.title ? `# ${article.title}\n\n` : `# ${url}\n\n`
        return `${title}${markdown}\n\n---\n`
    } catch (err: any) {
        if (err?.name === "AbortError") {
            return `# ${url}\n\nError: Timed out while fetching URL content.\n\n---\n`
        }
        // redirect:"error" rejects with a TypeError.
        return `# ${url}\n\nError: Could not fetch URL content.\n\n---\n`
    } finally {
        clearTimeout(timeoutId)
    }
}

/**
 * Local web content extraction tool (no external API / API key required).
 * Fetches pages directly, extracts the main article, and returns Markdown.
 */
export const webExtractTool = {
    description: `Extract full content from specific web pages.

Use this when:
- User provides a URL to analyze
- Need complete article/documentation content (not just a summary)
- Search results point to relevant pages that need full content

Returns: Full page content in clean Markdown format.

Note: Can extract up to 3 URLs at once.`,
    inputSchema: z.object({
        urls: z
            .array(z.string().url())
            .max(3)
            .describe("List of URLs to extract content from"),
    }),
    execute: async ({ urls }: { urls: string[] }) => {
        try {
            const parts = await Promise.all(
                urls.map((u) => extractUrlToMarkdown(u)),
            )
            return {
                results: parts.join("\n"),
                urls_processed: urls.length,
            }
        } catch (error) {
            console.error("[web_extract] Error:", error)
            return {
                error:
                    error instanceof Error ? error.message : "Extract failed",
            }
        }
    },
}
