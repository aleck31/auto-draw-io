import { STORAGE_KEYS } from "./storage"

/**
 * Get AI configuration from localStorage.
 * Returns API keys and settings for custom AI providers.
 * Used to override server defaults when user provides their own API key.
 */
export function getAIConfig() {
    if (typeof window === "undefined") {
        return {
            accessCode: "",
            aiProvider: "",
            aiBaseUrl: "",
            aiApiKey: "",
            aiModel: "",
            awsAccessKeyId: "",
            awsSecretAccessKey: "",
            awsRegion: "",
            maxOutputTokens: "",
        }
    }

    return {
        accessCode: localStorage.getItem(STORAGE_KEYS.accessCode) || "",
        aiProvider: localStorage.getItem(STORAGE_KEYS.aiProvider) || "",
        aiBaseUrl: localStorage.getItem(STORAGE_KEYS.aiBaseUrl) || "",
        aiApiKey: localStorage.getItem(STORAGE_KEYS.aiApiKey) || "",
        aiModel: localStorage.getItem(STORAGE_KEYS.aiModel) || "",
        awsAccessKeyId: localStorage.getItem(STORAGE_KEYS.awsAccessKeyId) || "",
        awsSecretAccessKey: localStorage.getItem(STORAGE_KEYS.awsSecretAccessKey) || "",
        awsRegion: localStorage.getItem(STORAGE_KEYS.awsRegion) || "",
        maxOutputTokens: localStorage.getItem(STORAGE_KEYS.maxOutputTokens) || "",
    }
}
