// Types for multi-provider model configuration

export type ProviderName =
    | "openai"
    | "anthropic"
    | "google"
    | "bedrock"
    | "openrouter"

// Individual model configuration
export interface ModelConfig {
    id: string // UUID for this model
    modelId: string // e.g., "gpt-4o", "claude-sonnet-4-5"
    validated?: boolean // Has this model been validated
    validationError?: string // Error message if validation failed
}

// Provider configuration
export interface ProviderConfig {
    id: string // UUID for this provider config
    provider: ProviderName
    name?: string // Custom display name (e.g., "OpenAI Production")
    apiKey: string
    baseUrl?: string
    // AWS Bedrock specific fields
    bedrockAuthType?: "credentials" | "bearerToken" // Default: "credentials"
    bedrockApiKey?: string // Bearer Token for Bedrock API key auth
    awsAccessKeyId?: string
    awsSecretAccessKey?: string
    awsRegion?: string
    awsSessionToken?: string // Optional, for temporary credentials
    models: ModelConfig[]
    validated?: boolean // Has API key been validated
}

// The complete multi-model configuration
export interface MultiModelConfig {
    version: 1
    providers: ProviderConfig[]
    selectedModelId?: string // Currently selected model's UUID
    showUnvalidatedModels?: boolean // Show models that haven't been validated
}

// Flattened model for dropdown display
export interface FlattenedModel {
    id: string // Model config UUID
    modelId: string // Actual model ID
    provider: ProviderName
    providerLabel: string // Provider display name
    apiKey: string
    baseUrl?: string
    // AWS Bedrock specific fields
    bedrockAuthType?: "credentials" | "bearerToken"
    bedrockApiKey?: string
    awsAccessKeyId?: string
    awsSecretAccessKey?: string
    awsRegion?: string
    awsSessionToken?: string
    validated?: boolean // Has this model been validated
}

// Provider metadata
export const PROVIDER_INFO: Record<
    ProviderName,
    { label: string; defaultBaseUrl?: string }
> = {
    openai: { label: "OpenAI" },
    anthropic: {
        label: "Anthropic",
        defaultBaseUrl: "https://api.anthropic.com/v1",
    },
    google: { label: "Google" },
    bedrock: { label: "Amazon Bedrock" },
    openrouter: { label: "OpenRouter" },
}

// Suggested models per provider for quick add
export const SUGGESTED_MODELS: Record<ProviderName, string[]> = {
    openai: [
        "gpt-5.5-pro",
        "gpt-5.5",
        "gpt-5.4-pro",
        "gpt-5.4",
        "gpt-5.4-mini",
        "gpt-5.4-nano",
        "gpt-5-codex-mini",
        "gpt-4.1",
        "gpt-4.1-mini",
        "gpt-4o",
        "gpt-4o-mini",
    ],
    anthropic: [
        // Claude 4.8 / 4.7 / 4.6 series (latest, dateless pinned IDs)
        "claude-opus-4-8",
        "claude-sonnet-4-6",
        "claude-haiku-4-5",
        "claude-opus-4-7",
        "claude-opus-4-6",
        // Claude 4.5 series
        "claude-sonnet-4-5-20250929",
        "claude-opus-4-5-20251101",
    ],
    google: [
        // Gemini 3 series
        "gemini-3.1-pro",
        "gemini-3.5-flash",
        "gemini-3-flash",
        "gemini-3.1-flash-lite",
    ],
    bedrock: [
        // Anthropic Claude
        "anthropic.claude-sonnet-5-5",
        "anthropic.claude-opus-5-5",
        "anthropic.claude-haiku-5-5",
        "anthropic.claude-fable-5-1",
        "anthropic.claude-sonnet-5",
        "anthropic.claude-opus-5",
        "anthropic.claude-opus-4-8",
        "anthropic.claude-opus-4-7",
        "anthropic.claude-sonnet-4-6",
        "anthropic.claude-opus-4-6-v1",
        "anthropic.claude-opus-4-5-20251101-v1:0",
        "anthropic.claude-sonnet-4-5-20250929-v1:0",
        "anthropic.claude-haiku-4-5-20251001-v1:0",
        // Amazon Nova
        "amazon.nova-2-lite-v1:0",
        "amazon.nova-premier-v1:0",
        // Meta Llama
        "meta.llama4-maverick-17b-instruct-v1:0",
        "meta.llama4-scout-17b-instruct-v1:0",
        "meta.llama3-3-70b-instruct-v1:0",
        // Mistral
        "mistral.mistral-large-3-675b-instruct",
        "mistral.pixtral-large-2502-v1:0",
    ],
    openrouter: [
        // Anthropic
        "anthropic/claude-opus-4.8",
        "anthropic/claude-sonnet-4.6",
        "anthropic/claude-haiku-4.5",
        // OpenAI
        "openai/gpt-5.5",
        "openai/gpt-5.4",
        "openai/gpt-5.4-mini",
        "openai/gpt-4o-mini",
        // Google
        "google/gemini-3.1-pro-preview",
        "google/gemini-3.5-flash",
        "google/gemini-2.5-flash-lite",
        // xAI
        "x-ai/grok-4.3",
        // Meta Llama
        "meta-llama/llama-4-maverick",
        "meta-llama/llama-4-scout",
        "meta-llama/llama-3.3-70b-instruct",
        // DeepSeek
        "deepseek/deepseek-v4-pro",
        "deepseek/deepseek-v3.2",
        // Qwen
        "qwen/qwen3.7-max",
        "qwen/qwen3-coder",
        // MiniMax
        "minimax/minimax-m3",
    ],
}

// Helper to generate UUID
export function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

// Create empty config
export function createEmptyConfig(): MultiModelConfig {
    return {
        version: 1,
        providers: [],
        selectedModelId: undefined,
    }
}

// Create new provider config
export function createProviderConfig(provider: ProviderName): ProviderConfig {
    return {
        id: generateId(),
        provider,
        apiKey: "",
        baseUrl: PROVIDER_INFO[provider].defaultBaseUrl,
        models: [],
        validated: false,
    }
}

// Create new model config
export function createModelConfig(modelId: string): ModelConfig {
    return {
        id: generateId(),
        modelId,
    }
}

// Get all models as flattened list for dropdown
export function flattenModels(config: MultiModelConfig): FlattenedModel[] {
    const models: FlattenedModel[] = []

    for (const provider of config.providers) {
        // Skip providers that are no longer supported
        if (!PROVIDER_INFO[provider.provider]) {
            continue
        }

        // Use custom name if provided, otherwise use default provider label
        const providerLabel =
            provider.name || PROVIDER_INFO[provider.provider].label

        for (const model of provider.models) {
            models.push({
                id: model.id,
                modelId: model.modelId,
                provider: provider.provider,
                providerLabel,
                apiKey: provider.apiKey,
                baseUrl: provider.baseUrl,
                // AWS Bedrock fields
                bedrockAuthType: provider.bedrockAuthType,
                bedrockApiKey: provider.bedrockApiKey,
                awsAccessKeyId: provider.awsAccessKeyId,
                awsSecretAccessKey: provider.awsSecretAccessKey,
                awsRegion: provider.awsRegion,
                awsSessionToken: provider.awsSessionToken,
                validated: model.validated,
            })
        }
    }

    return models
}

// Find model by ID
export function findModelById(
    config: MultiModelConfig,
    modelId: string,
): FlattenedModel | undefined {
    return flattenModels(config).find((m) => m.id === modelId)
}
