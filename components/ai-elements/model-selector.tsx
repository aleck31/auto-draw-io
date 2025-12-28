import { Bot, Cloud, Globe, Sparkles } from "lucide-react"
import type { ComponentProps, ReactNode } from "react"
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
} from "@/components/ui/command"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export type ModelSelectorProps = ComponentProps<typeof Popover>

export const ModelSelector = (props: ModelSelectorProps) => (
    <Popover {...props} />
)

export type ModelSelectorTriggerProps = ComponentProps<typeof PopoverTrigger>

export const ModelSelectorTrigger = (props: ModelSelectorTriggerProps) => (
    <PopoverTrigger {...props} />
)

export type ModelSelectorContentProps = ComponentProps<
    typeof PopoverContent
> & {
    title?: ReactNode
}

export const ModelSelectorContent = ({
    className,
    children,
    title = "Model Selector",
    ...props
}: ModelSelectorContentProps) => (
    <PopoverContent
        className={cn("w-[300px] p-0", className)}
        align="start"
        {...props}
    >
        <Command>{children}</Command>
    </PopoverContent>
)

export type ModelSelectorInputProps = ComponentProps<typeof CommandInput>

export const ModelSelectorInput = ({
    className,
    ...props
}: ModelSelectorInputProps) => (
    <CommandInput className={cn("h-auto py-3.5", className)} {...props} />
)

export type ModelSelectorListProps = ComponentProps<typeof CommandList>

export const ModelSelectorList = ({
    className,
    ...props
}: ModelSelectorListProps) => (
    <div className="relative">
        <CommandList
            className={cn(
                // Hide scrollbar on all platforms
                "[&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]",
                className,
            )}
            {...props}
        />
        {/* Bottom shadow indicator for scrollable content */}
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-muted/80 via-muted/40 to-transparent" />
    </div>
)

export type ModelSelectorEmptyProps = ComponentProps<typeof CommandEmpty>

export const ModelSelectorEmpty = (props: ModelSelectorEmptyProps) => (
    <CommandEmpty {...props} />
)

export type ModelSelectorGroupProps = ComponentProps<typeof CommandGroup>

export const ModelSelectorGroup = (props: ModelSelectorGroupProps) => (
    <CommandGroup {...props} />
)

export type ModelSelectorItemProps = ComponentProps<typeof CommandItem>

export const ModelSelectorItem = (props: ModelSelectorItemProps) => (
    <CommandItem {...props} />
)

export type ModelSelectorSeparatorProps = ComponentProps<
    typeof CommandSeparator
>

export const ModelSelectorSeparator = (props: ModelSelectorSeparatorProps) => (
    <CommandSeparator {...props} />
)

export type ModelSelectorLogoProps = {
    provider: string
    className?: string
}

export const ModelSelectorLogo = ({
    provider,
    className,
}: ModelSelectorLogoProps) => {
    const iconClass = cn("size-4", className)

    // Use Lucide icons for all providers
    switch (provider) {
        case "amazon-bedrock":
        case "bedrock":
            return <Cloud className={iconClass} />
        case "openai":
            return <Sparkles className={iconClass} />
        case "anthropic":
            return <Bot className={iconClass} />
        case "google":
            return <Globe className={iconClass} />
        case "openrouter":
            return <Globe className={iconClass} />
        default:
            return <Bot className={iconClass} />
    }
}

export type ModelSelectorLogoGroupProps = ComponentProps<"div">

export const ModelSelectorLogoGroup = ({
    className,
    ...props
}: ModelSelectorLogoGroupProps) => (
    <div
        className={cn(
            "-space-x-1 flex shrink-0 items-center [&>img]:rounded-full [&>img]:bg-background [&>img]:p-px [&>img]:ring-1 dark:[&>img]:bg-foreground",
            className,
        )}
        {...props}
    />
)

export type ModelSelectorNameProps = ComponentProps<"span">

export const ModelSelectorName = ({
    className,
    ...props
}: ModelSelectorNameProps) => (
    <span className={cn("flex-1 truncate text-left", className)} {...props} />
)
