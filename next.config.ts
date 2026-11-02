import type { NextConfig } from "next"
import packageJson from "./package.json"

const nextConfig: NextConfig = {
    /* config options here */
    output: "standalone",
    // Support for subdirectory deployment (e.g., https://example.com/nextaidrawio)
    // Set AUTO_BASE_PATH environment variable to your subdirectory path (e.g., /nextaidrawio)
    basePath: process.env.AUTO_BASE_PATH || "",
    env: {
        APP_VERSION: packageJson.version,
        // Inlined at build time: client components only see what is listed here
        // (or NEXT_PUBLIC_*), so these must be set when the image is built.
        EMBED_DRAWIO_BASE_URL: process.env.EMBED_DRAWIO_BASE_URL || "",
        AUTO_BASE_PATH: process.env.AUTO_BASE_PATH || "",
    },
    // Include instrumentation.ts in standalone build for Langfuse telemetry
    outputFileTracingIncludes: {
        "*": ["./instrumentation.ts"],
    },
    async headers() {
        return [
            {
                // The bundled draw.io runs on our origin, next to the user's
                // API keys in localStorage: only this app may frame it.
                // Versioned path (scripts/drawio-version.json), so immutable.
                source: "/drawio/:path*",
                headers: [
                    {
                        key: "Content-Security-Policy",
                        value: "frame-ancestors 'self'",
                    },
                    { key: "X-Frame-Options", value: "SAMEORIGIN" },
                    {
                        key: "Cache-Control",
                        value: "public, max-age=31536000, immutable",
                    },
                ],
            },
        ]
    },
}

export default nextConfig
