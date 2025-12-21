import fs from "fs/promises"
import path from "path"
import { z } from "zod"

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
- UI/Mockups: android
- Enterprise: citrix, sap, mscae, atlassian
- Engineering: fluidpower, electrical, pid, cabinets, floorplan
- Icons: webicons

Call this tool to get shape names and usage syntax for a specific library.`,
    inputSchema: z.object({
        library: z
            .string()
            .describe(
                "Library name (e.g., 'aws4', 'kubernetes', 'flowchart')",
            ),
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
                return `Library "${library}" not found. Available: aws4, azure2, gcp2, alibaba_cloud, cisco19, kubernetes, network, bpmn, flowchart, basic, arrows2, vvd, salesforce, citrix, sap, mscae, atlassian, fluidpower, electrical, pid, cabinets, floorplan, webicons, infographic, sitemap, android, lean_mapping, openstack, rack`
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
                error:
                    error instanceof Error ? error.message : "Search failed",
            }
        }
    },
})

/**
 * Create Tavily web extract tool
 * Returns a tool definition that uses the provided API key
 */
export const createWebExtractTool = (apiKey: string) => ({
    description: `Extract full content from specific web pages.

Use this when:
- User provides a URL to analyze
- Need complete article/documentation content (not just summary)
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
            const response = await fetch("https://api.tavily.com/extract", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    api_key: apiKey,
                    urls,
                }),
            })

            if (!response.ok) {
                throw new Error(
                    `Tavily Extract API error: ${response.status}`,
                )
            }

            const data = await response.json()

            // Format extracted content
            const results = data.results
                .map(
                    (r: any) =>
                        `# ${r.url}\n\n${r.raw_content || "Failed to extract content"}\n\n---\n`,
                )
                .join("\n")

            return {
                results,
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
})

