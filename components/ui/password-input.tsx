import { useState } from "react"
import { Eye, EyeOff } from "lucide-react"
import { Input } from "@/components/ui/input"

interface PasswordInputProps {
    id?: string
    value: string
    onChange: (value: string) => void
    placeholder?: string
    onKeyDown?: (e: React.KeyboardEvent) => void
    autoComplete?: string
}

export function PasswordInput({
    id,
    value,
    onChange,
    placeholder,
    onKeyDown,
    autoComplete = "off",
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
            />
            <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                onClick={() => setShowPassword(!showPassword)}
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
