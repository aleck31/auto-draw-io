"use client"

import { Moon, Sun } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useState } from "react"
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
import { useDictionary } from "@/hooks/use-dictionary"
import { getApiEndpoint } from "@/lib/base-path"
import { STORAGE_KEYS } from "@/lib/storage"
import { cn } from "@/lib/utils"

// Reusable setting item component for consistent layout
function SettingItem({
    label,
    description,
    children,
}: {
    label: string
    description?: string
    children: React.ReactNode
}) {
    return (
        <div className="flex items-center justify-between py-4 first:pt-0 last:pb-0">
            <div className="space-y-0.5 pr-4">
                <Label className="text-sm font-medium">{label}</Label>
                {description && (
                    <p className="text-xs text-muted-foreground max-w-[260px]">
                        {description}
                    </p>
                )}
            </div>
            <div className="shrink-0">{children}</div>
        </div>
    )
}

interface SettingsDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onCloseProtectionChange?: (enabled: boolean) => void
    drawioUi: "min" | "sketch"
    onToggleDrawioUi: () => void
    darkMode: boolean
    onToggleDarkMode: () => void
}

export const STORAGE_ACCESS_CODE_KEY = "auto-draw-io-access-code"
export const STORAGE_CLOSE_PROTECTION_KEY = "auto-draw-io-close-protection"
const STORAGE_ACCESS_CODE_REQUIRED_KEY = "auto-draw-io-access-code-required"

function getStoredAccessCodeRequired(): boolean | null {
    if (typeof window === "undefined") return null
    const stored = localStorage.getItem(STORAGE_ACCESS_CODE_REQUIRED_KEY)
    if (stored === null) return null
    return stored === "true"
}

function SettingsContent({
    open,
    onOpenChange,
    onCloseProtectionChange,
    drawioUi,
    onToggleDrawioUi,
    darkMode,
    onToggleDarkMode,
}: SettingsDialogProps) {
    const dict = useDictionary()
    const router = useRouter()
    const search = useSearchParams()
    const [accessCode, setAccessCode] = useState("")
    const [closeProtection, setCloseProtection] = useState(true)
    const [isVerifying, setIsVerifying] = useState(false)
    const [error, setError] = useState("")
    const [accessCodeRequired, setAccessCodeRequired] = useState(
        () => getStoredAccessCodeRequired() ?? false,
    )
    const [tavilyApiKey, setTavilyApiKey] = useState("")

    useEffect(() => {
        // Only fetch if not cached in localStorage
        if (getStoredAccessCodeRequired() !== null) return

        fetch(getApiEndpoint("/api/config"))
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

            const storedTavilyKey =
                localStorage.getItem(STORAGE_KEYS.tavilyApiKey) || ""
            setTavilyApiKey(storedTavilyKey)

            const storedCloseProtection = localStorage.getItem(
                STORAGE_CLOSE_PROTECTION_KEY,
            )
            // Default to true if not set
            setCloseProtection(storedCloseProtection !== "false")

            setError("")
        }
    }, [open])

    const handleSave = async () => {
        if (!accessCodeRequired) return

        setError("")
        setIsVerifying(true)

        try {
            const response = await fetch(
                getApiEndpoint("/api/verify-access-code"),
                {
                    method: "POST",
                    headers: {
                        "x-access-code": accessCode.trim(),
                    },
                },
            )

            const data = await response.json()

            if (!data.valid) {
                setError(data.message || dict.errors.invalidAccessCode)
                return
            }

            localStorage.setItem(STORAGE_ACCESS_CODE_KEY, accessCode.trim())
            // Don't close dialog after successful save
        } catch {
            setError(dict.errors.networkError)
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
        <DialogContent className="sm:max-w-lg p-0 gap-0">
            {/* Header */}
            <DialogHeader className="px-6 pt-6 pb-4">
                <DialogTitle>{dict.settings.title}</DialogTitle>
                <DialogDescription className="mt-1">
                    {dict.settings.description}
                </DialogDescription>
            </DialogHeader>

            {/* Content */}
            <div className="px-6 pb-6">
                <div className="divide-y divide-border-subtle">
                    {/* Access Code (conditional) */}
                    {accessCodeRequired && (
                        <div className="py-4 first:pt-0 space-y-3">
                            <div className="space-y-0.5">
                                <Label
                                    htmlFor="access-code"
                                    className="text-sm font-medium"
                                >
                                    {dict.settings.accessCode}
                                </Label>
                                <p className="text-xs text-muted-foreground">
                                    {dict.settings.accessCodeDescription}
                                </p>
                            </div>
                            <div className="flex gap-2">
                                <PasswordInput
                                    id="access-code"
                                    value={accessCode}
                                    onChange={setAccessCode}
                                    onKeyDown={handleKeyDown}
                                    placeholder={
                                        dict.settings.accessCodePlaceholder
                                    }
                                    autoComplete="off"
                                />
                                <Button
                                    onClick={handleSave}
                                    disabled={isVerifying || !accessCode.trim()}
                                    className="h-9 px-4 rounded-xl"
                                >
                                    {isVerifying ? "..." : dict.common.save}
                                </Button>
                                {accessCode && (
                                    <Button
                                        onClick={() => {
                                            setAccessCode("")
                                            localStorage.removeItem(
                                                STORAGE_ACCESS_CODE_KEY,
                                            )
                                            setError("")
                                        }}
                                        variant="outline"
                                        className="h-9 px-4 rounded-xl"
                                    >
                                        {dict.common.clear}
                                    </Button>
                                )}
                            </div>
                            {error && (
                                <p className="text-xs text-destructive">
                                    {error}
                                </p>
                            )}
                        </div>
                    )}

                    {/* Tavily API Key */}
                    <div className="py-4 space-y-3">
                        <div className="space-y-0.5">
                            <Label
                                htmlFor="tavily-api-key"
                                className="text-sm font-medium"
                            >
                                Tavily API Key (Optional)
                            </Label>
                            <p className="text-xs text-muted-foreground">
                                For web search and content extraction tools
                            </p>
                        </div>
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
                            placeholder="tvly-..."
                            autoComplete="off"
                        />
                    </div>

                    {/* Theme */}
                    <SettingItem
                        label={dict.settings.theme}
                        description={dict.settings.themeDescription}
                    >
                        <Button
                            id="theme-toggle"
                            variant="outline"
                            size="icon"
                            onClick={onToggleDarkMode}
                            className="h-9 w-9 rounded-xl border-border-subtle hover:bg-interactive-hover"
                        >
                            {darkMode ? (
                                <Sun className="h-4 w-4" />
                            ) : (
                                <Moon className="h-4 w-4" />
                            )}
                        </Button>
                    </SettingItem>

                    {/* Draw.io Style */}
                    <SettingItem
                        label={dict.settings.drawioStyle}
                        description={`${dict.settings.drawioStyleDescription} ${
                            drawioUi === "min"
                                ? dict.settings.minimal
                                : dict.settings.sketch
                        }`}
                    >
                        <Button
                            id="drawio-ui"
                            variant="outline"
                            onClick={onToggleDrawioUi}
                            className="h-9 w-[120px] rounded-xl border-border-subtle hover:bg-interactive-hover font-normal"
                        >
                            {dict.settings.switchTo}{" "}
                            {drawioUi === "min"
                                ? dict.settings.sketch
                                : dict.settings.minimal}
                        </Button>
                    </SettingItem>

                    {/* Close Protection */}
                    <SettingItem
                        label={dict.settings.closeProtection}
                        description={dict.settings.closeProtectionDescription}
                    >
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
                    </SettingItem>
                </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-border-subtle bg-surface-1/50 rounded-b-2xl">
                <p className="text-xs text-muted-foreground text-center">
                    Version {process.env.APP_VERSION}
                </p>
            </div>
        </DialogContent>
    )
}

export function SettingsDialog(props: SettingsDialogProps) {
    return (
        <Dialog open={props.open} onOpenChange={props.onOpenChange}>
            <Suspense
                fallback={
                    <DialogContent className="sm:max-w-lg p-0">
                        <div className="h-80 flex items-center justify-center">
                            <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
                        </div>
                    </DialogContent>
                }
            >
                <SettingsContent {...props} />
            </Suspense>
        </Dialog>
    )
}
