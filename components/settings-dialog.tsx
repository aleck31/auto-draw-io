"use client"

import { Moon, Sun } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PasswordInput } from "@/components/ui/password-input"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"

interface SettingsDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onCloseProtectionChange?: (enabled: boolean) => void
    drawioUi: "min" | "sketch"
    onToggleDrawioUi: () => void
    darkMode: boolean
    onToggleDarkMode: () => void
}

import { STORAGE_KEYS } from "@/lib/storage"

export const STORAGE_ACCESS_CODE_KEY = STORAGE_KEYS.accessCode
export const STORAGE_CLOSE_PROTECTION_KEY = "auto-draw-io-close-protection"
const STORAGE_ACCESS_CODE_REQUIRED_KEY = "auto-draw-io-access-code-required"

function getStoredAccessCodeRequired(): boolean | null {
    if (typeof window === "undefined") return null
    const stored = localStorage.getItem(STORAGE_ACCESS_CODE_REQUIRED_KEY)
    if (stored === null) return null
    return stored === "true"
}

export function SettingsDialog({
    open,
    onOpenChange,
    onCloseProtectionChange,
    drawioUi,
    onToggleDrawioUi,
    darkMode,
    onToggleDarkMode,
}: SettingsDialogProps) {
    const [accessCode, setAccessCode] = useState("")
    const [closeProtection, setCloseProtection] = useState(true)
    const [isVerifying, setIsVerifying] = useState(false)
    const [error, setError] = useState("")
    const [accessCodeSaved, setAccessCodeSaved] = useState(false)
    const [accessCodeRequired, setAccessCodeRequired] = useState(
        () => getStoredAccessCodeRequired() ?? false,
    )
    const [provider, setProvider] = useState("")
    const [baseUrl, setBaseUrl] = useState("")
    const [apiKey, setApiKey] = useState("")
    const [modelId, setModelId] = useState("")
    const [awsAccessKeyId, setAwsAccessKeyId] = useState("")
    const [awsSecretAccessKey, setAwsSecretAccessKey] = useState("")
    const [awsRegion, setAwsRegion] = useState("")
    const [maxOutputTokens, setMaxOutputTokens] = useState("")
    const [tavilyApiKey, setTavilyApiKey] = useState("")

    useEffect(() => {
        // Only fetch if not cached in localStorage
        if (getStoredAccessCodeRequired() !== null) return

        fetch("/api/config")
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`)
                return res.json()
            })
            .then((data) => {
                const required = data?.accessCodeRequired === true
                localStorage.setItem(
                    STORAGE_ACCESS_CODE_REQUIRED_KEY,
                    String(required),
                )
                setAccessCodeRequired(required)
            })
            .catch(() => {
                // Don't cache on error - allow retry on next mount
                setAccessCodeRequired(false)
            })
    }, [])

    useEffect(() => {
        if (open) {
            const storedCode =
                localStorage.getItem(STORAGE_ACCESS_CODE_KEY) || ""
            setAccessCode(storedCode)

            const storedCloseProtection = localStorage.getItem(
                STORAGE_CLOSE_PROTECTION_KEY,
            )
            // Default to true if not set
            setCloseProtection(storedCloseProtection !== "false")

            // Load AI provider settings
            setProvider(localStorage.getItem(STORAGE_KEYS.aiProvider) || "")
            setBaseUrl(localStorage.getItem(STORAGE_KEYS.aiBaseUrl) || "")
            setApiKey(localStorage.getItem(STORAGE_KEYS.aiApiKey) || "")
            setModelId(localStorage.getItem(STORAGE_KEYS.aiModel) || "")
            setAwsAccessKeyId(localStorage.getItem(STORAGE_KEYS.awsAccessKeyId) || "")
            setAwsSecretAccessKey(localStorage.getItem(STORAGE_KEYS.awsSecretAccessKey) || "")
            setAwsRegion(localStorage.getItem(STORAGE_KEYS.awsRegion) || "")
            setMaxOutputTokens(localStorage.getItem(STORAGE_KEYS.maxOutputTokens) || "")
            setTavilyApiKey(localStorage.getItem(STORAGE_KEYS.tavilyApiKey) || "")

            setError("")
            setAccessCodeSaved(false)
        }
    }, [open])

    const handleSave = async () => {
        if (!accessCodeRequired) return

        setError("")
        setIsVerifying(true)

        try {
            const response = await fetch("/api/verify-access-code", {
                method: "POST",
                headers: {
                    "x-access-code": accessCode.trim(),
                },
            })

            const data = await response.json()

            if (!data.valid) {
                setError(data.message || "Invalid access code")
                return
            }

            localStorage.setItem(STORAGE_ACCESS_CODE_KEY, accessCode.trim())
            setAccessCodeSaved(true)
            setError("")
        } catch {
            setError("Failed to verify access code")
        } finally {
            setIsVerifying(false)
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault()
            handleSave()
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Settings</DialogTitle>
                    <DialogDescription>
                        Configure your application settings.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    <div className="space-y-2">
                        <Label>LLM Provider Settings</Label>
                        <p className="text-[0.8rem] text-muted-foreground">
                            Your key is stored locally in your browser and is 
                            never stored on the server.
                        </p>
                        <div className="space-y-3 pt-2">
                            <div className="space-y-2">
                                <Label htmlFor="ai-provider">Provider</Label>
                                <Select
                                    value={provider || "default"}
                                    onValueChange={(value) => {
                                        const actualValue =
                                            value === "default" ? "" : value
                                        setProvider(actualValue)
                                        localStorage.setItem(
                                            STORAGE_KEYS.aiProvider,
                                            actualValue,
                                        )
                                    }}
                                >
                                    <SelectTrigger id="ai-provider">
                                        <SelectValue placeholder="Built-in Configuration" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="default">
                                            Built-in Configuration
                                        </SelectItem>
                                        <SelectItem value="bedrock">
                                            AWS Bedrock
                                        </SelectItem>
                                        <SelectItem value="openai">
                                            OpenAI
                                        </SelectItem>
                                        <SelectItem value="anthropic">
                                            Anthropic
                                        </SelectItem>
                                        <SelectItem value="google">
                                            Google
                                        </SelectItem>
                                        <SelectItem value="openrouter">
                                            OpenRouter
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Built-in Configuration - Access Code */}
                            {(!provider || provider === "default") && accessCodeRequired && (
                                <div className="space-y-2">
                                    <Label htmlFor="access-code">Access Code</Label>
                                    <div className="flex gap-2">
                                        <PasswordInput
                                            id="access-code"
                                            value={accessCode}
                                            onChange={(value) => {
                                                setAccessCode(value)
                                                setAccessCodeSaved(false)
                                            }}
                                            placeholder="Enter access code"
                                            onKeyDown={handleKeyDown}
                                        />
                                        <Button
                                            onClick={handleSave}
                                            disabled={isVerifying || !accessCode.trim() || accessCodeSaved}
                                        >
                                            {isVerifying ? "..." : accessCodeSaved ? "Saved" : "Check"}
                                        </Button>
                                    </div>
                                    <p className="text-[0.8rem] text-muted-foreground">
                                        Access Code is required to access the built-in LLM provider.
                                    </p>
                                    {error && (
                                        <p className="text-[0.8rem] text-destructive">
                                            {error}
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* Custom Provider Configurations */}
                            {provider && provider !== "default" && (
                                <>
                                    <div className="space-y-2">
                                        <Label htmlFor="ai-model">
                                            Model ID
                                        </Label>
                                        <Input
                                            id="ai-model"
                                            value={modelId}
                                            onChange={(e) => {
                                                setModelId(e.target.value)
                                                localStorage.setItem(
                                                    STORAGE_KEYS.aiModel,
                                                    e.target.value,
                                                )
                                            }}
                                            placeholder={
                                                provider === "openai"
                                                    ? "e.g., gpt-4o"
                                                    : provider === "anthropic"
                                                      ? "e.g., claude-sonnet-4-5"
                                                      : provider === "google"
                                                        ? "e.g., gemini-2.0-flash-exp"
                                                        : provider === "bedrock"
                                                          ? "e.g., anthropic.claude-sonnet-4-5-v1:0"
                                                          : "Model ID"
                                            }
                                        />
                                    </div>

                                    {provider === "bedrock" ? (
                                        // Bedrock-specific AWS credentials
                                        <>
                                            <div className="space-y-2">
                                                <Label htmlFor="aws-access-key-id">
                                                    AWS Access Key ID
                                                </Label>
                                                <PasswordInput
                                                    id="aws-access-key-id"
                                                    value={awsAccessKeyId}
                                                    onChange={(value) => {
                                                        setAwsAccessKeyId(value)
                                                        localStorage.setItem(
                                                            STORAGE_KEYS.awsAccessKeyId,
                                                            value,
                                                        )
                                                    }}
                                                    placeholder="Enter your AWS Access Key ID"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="aws-secret-access-key">
                                                    AWS Secret Access Key
                                                </Label>
                                                <PasswordInput
                                                    id="aws-secret-access-key"
                                                    value={awsSecretAccessKey}
                                                    onChange={(value) => {
                                                        setAwsSecretAccessKey(value)
                                                        localStorage.setItem(
                                                            STORAGE_KEYS.awsSecretAccessKey,
                                                            value,
                                                        )
                                                    }}
                                                    placeholder="Enter your AWS Secret Access Key"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="aws-region">
                                                    AWS Region
                                                </Label>
                                                <Input
                                                    id="aws-region"
                                                    value={awsRegion}
                                                    onChange={(e) => {
                                                        setAwsRegion(e.target.value)
                                                        localStorage.setItem(
                                                            STORAGE_KEYS.awsRegion,
                                                            e.target.value,
                                                        )
                                                    }}
                                                    placeholder="e.g., us-east-1"
                                                />
                                                <p className="text-[0.8rem] text-muted-foreground">
                                                    Use your own AWS credentials to bypass usage limits.
                                                </p>
                                            </div>
                                        </>
                                    ) : (
                                        // Standard API Key configuration for other providers
                                        <>
                                            <div className="space-y-2">
                                                <Label htmlFor="ai-api-key">
                                                    API Key
                                                </Label>
                                                <PasswordInput
                                                    id="ai-api-key"
                                                    value={apiKey}
                                                    onChange={(value) => {
                                                        setApiKey(value)
                                                        localStorage.setItem(
                                                            STORAGE_KEYS.aiApiKey,
                                                            value,
                                                        )
                                                    }}
                                                    placeholder="Enter your API key"
                                                />
                                                <p className="text-[0.8rem] text-muted-foreground">
                                                    Use your own API key to bypass usage limits.
                                                </p>
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="ai-base-url">
                                                    Base URL (optional)
                                                </Label>
                                                <Input
                                                    id="ai-base-url"
                                                    value={baseUrl}
                                                    onChange={(e) => {
                                                        setBaseUrl(e.target.value)
                                                        localStorage.setItem(
                                                            STORAGE_KEYS.aiBaseUrl,
                                                            e.target.value,
                                                        )
                                                    }}
                                                    placeholder={
                                                        provider === "anthropic"
                                                            ? "https://api.anthropic.com/v1"
                                                            : "Custom endpoint URL"
                                                    }
                                                />
                                            </div>
                                        </>
                                    )}

                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="w-full"
                                        onClick={() => {
                                            localStorage.removeItem(
                                                STORAGE_KEYS.aiProvider,
                                            )
                                            localStorage.removeItem(
                                                STORAGE_KEYS.aiBaseUrl,
                                            )
                                            localStorage.removeItem(
                                                STORAGE_KEYS.aiApiKey,
                                            )
                                            localStorage.removeItem(
                                                STORAGE_KEYS.aiModel,
                                            )
                                            localStorage.removeItem(
                                                STORAGE_KEYS.awsAccessKeyId,
                                            )
                                            localStorage.removeItem(
                                                STORAGE_KEYS.awsSecretAccessKey,
                                            )
                                            localStorage.removeItem(
                                                STORAGE_KEYS.awsRegion,
                                            )
                                            setProvider("")
                                            setBaseUrl("")
                                            setApiKey("")
                                            setModelId("")
                                            setAwsAccessKeyId("")
                                            setAwsSecretAccessKey("")
                                            setAwsRegion("")
                                        }}
                                    >
                                        Clear Settings
                                    </Button>
                                </>
                            )}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="max-output-tokens">
                            Max Output Tokens (Optional)
                        </Label>
                        <Input
                            id="max-output-tokens"
                            type="number"
                            value={maxOutputTokens}
                            onChange={(e) => {
                                setMaxOutputTokens(e.target.value)
                                localStorage.setItem(
                                    STORAGE_KEYS.maxOutputTokens,
                                    e.target.value,
                                )
                            }}
                            placeholder="e.g., 64000 (leave empty for model default)"
                        />
                        <p className="text-[0.8rem] text-muted-foreground">
                            Maximum tokens the AI can generate. Helps prevent truncation.
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="tavily-api-key">
                            Tavily API Key (Optional)
                        </Label>
                        <PasswordInput
                            id="tavily-api-key"
                            value={tavilyApiKey}
                            onChange={(value) => {
                                setTavilyApiKey(value)
                                localStorage.setItem(
                                    STORAGE_KEYS.tavilyApiKey,
                                    value,
                                )
                            }}
                            placeholder="Enter your Tavily API key"
                        />
                        <p className="text-[0.8rem] text-muted-foreground">
                            Enable web search and content extraction capabilities.
                        </p>
                    </div>

                    <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <Label htmlFor="theme-toggle">Theme</Label>
                            <p className="text-[0.8rem] text-muted-foreground">
                                Dark/Light mode for interface and DrawIO canvas.
                            </p>
                        </div>
                        <Button
                            id="theme-toggle"
                            variant="outline"
                            size="icon"
                            onClick={onToggleDarkMode}
                        >
                            {darkMode ? (
                                <Sun className="h-4 w-4" />
                            ) : (
                                <Moon className="h-4 w-4" />
                            )}
                        </Button>
                    </div>

                    <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <Label htmlFor="drawio-ui">DrawIO Style</Label>
                            <p className="text-[0.8rem] text-muted-foreground">
                                Canvas style:{" "}
                                {drawioUi === "min" ? "Minimal" : "Sketch"}
                            </p>
                        </div>
                        <Button
                            id="drawio-ui"
                            variant="outline"
                            size="sm"
                            onClick={onToggleDrawioUi}
                        >
                            Switch to{" "}
                            {drawioUi === "min" ? "Sketch" : "Minimal"}
                        </Button>
                    </div>

                    <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <Label htmlFor="close-protection">
                                Close Protection
                            </Label>
                            <p className="text-[0.8rem] text-muted-foreground">
                                Show confirmation when leaving the page.
                            </p>
                        </div>
                        <Switch
                            id="close-protection"
                            checked={closeProtection}
                            onCheckedChange={(checked) => {
                                setCloseProtection(checked)
                                localStorage.setItem(
                                    STORAGE_CLOSE_PROTECTION_KEY,
                                    checked.toString(),
                                )
                                onCloseProtectionChange?.(checked)
                            }}
                        />
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
