import { useState } from "react"
import { Eye, EyeOff } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface PasswordInputProps {
    id?: string
    value: string
    onChange: (value: string) => void
    placeholder?: string
    onKeyDown?: (e: React.KeyboardEvent) => void
    autoComplete?: string
    className?: string
    "aria-label"?: string
}

export function PasswordInput({
    id,
    value,
    onChange,
    placeholder,
    onKeyDown,
    autoComplete = "off",
    className,
    "aria-label": ariaLabel,
}: PasswordInputProps) {
    const [showPassword, setShowPassword] = useState(false)

    return (
        <div className="relative flex-1">
            <Input
                id={id}
                type={showPassword ? "text" : "password"}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                onKeyDown={onKeyDown}
                autoComplete={autoComplete}
                className={cn("pr-10", className)}
            />
            <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={ariaLabel || (showPassword ? "Hide password" : "Show password")}
            >
                {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                ) : (
                    <Eye className="h-4 w-4" />
                )}
            </button>
        </div>
    )
}
