/**
 * The app's mark: draw.io's selection frame and handles around the accent
 * shape. Ink follows the text colour; the accent is the app's indigo.
 * The favicon and PWA icons in public/ are this drawing on a #2B3242 tile:
 * regenerate them when it changes.
 */
export function AppLogo({ className }: { className?: string }) {
    return (
        <svg
            viewBox="0 0 32 32"
            fill="none"
            aria-hidden="true"
            className={className}
        >
            <rect
                x="5"
                y="5"
                width="22"
                height="22"
                stroke="currentColor"
                strokeWidth="2"
            />
            <g fill="currentColor">
                <rect x="2.5" y="2.5" width="5" height="5" rx="1.2" />
                <rect x="24.5" y="2.5" width="5" height="5" rx="1.2" />
                <rect x="2.5" y="24.5" width="5" height="5" rx="1.2" />
                <rect x="24.5" y="24.5" width="5" height="5" rx="1.2" />
            </g>
            <rect
                x="10"
                y="10"
                width="12"
                height="12"
                rx="2.6"
                className="fill-[#4F5FE0] dark:fill-[#8A97F7]"
            />
        </svg>
    )
}
