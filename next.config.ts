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
}

export default nextConfig
