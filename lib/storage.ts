// Centralized localStorage keys
// Consolidates all storage keys from chat-panel.tsx and settings-dialog.tsx

export const STORAGE_KEYS = {
    // Chat data
    messages: "auto-draw-io-messages",
    xmlSnapshots: "auto-draw-io-xml-snapshots",
    diagramXml: "auto-draw-io-diagram-xml",
    sessionId: "auto-draw-io-session-id",

    // Quota tracking
    requestCount: "auto-draw-io-request-count",
    requestDate: "auto-draw-io-request-date",
    tokenCount: "auto-draw-io-token-count",
    tokenDate: "auto-draw-io-token-date",
    tpmCount: "auto-draw-io-tpm-count",
    tpmMinute: "auto-draw-io-tpm-minute",

    // Settings
    accessCode: "auto-draw-io-access-code",
    closeProtection: "auto-draw-io-close-protection",
    accessCodeRequired: "auto-draw-io-access-code-required",
    aiProvider: "auto-draw-io-ai-provider",
    aiBaseUrl: "auto-draw-io-ai-base-url",
    aiApiKey: "auto-draw-io-ai-api-key",
    aiModel: "auto-draw-io-ai-model",
    // AWS Bedrock credentials
    awsAccessKeyId: "auto-draw-io-aws-access-key-id",
    awsSecretAccessKey: "auto-draw-io-aws-secret-access-key",
    awsRegion: "auto-draw-io-aws-region",
} as const
