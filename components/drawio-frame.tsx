"use client"

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react"
import {
    attachEditor,
    detachEditor,
    watchForEditorUi,
} from "@/lib/drawio-bridge"

export interface DrawioExportEvent {
    event: "export"
    format: string
    data: string
    xml: string
    message: { parentEvent?: string; [key: string]: unknown }
}

export interface DrawioFrameHandle {
    load: (data: { xml: string }) => void
    exportDiagram: (data: { format: string; [key: string]: unknown }) => void
}

interface DrawioFrameProps {
    src: string
    onLoad?: () => void
    onAutoSave?: (data: { xml?: string }) => void
    onExport?: (data: DrawioExportEvent) => void
    /** draw.io's own Save button (or Ctrl+S) */
    onSave?: () => void
}

/**
 * The draw.io editor in an iframe, speaking draw.io's postMessage embed
 * protocol. Messages go only to draw.io's origin, and only messages from this
 * frame and that origin are handled.
 *
 * Adapted from next-ai-draw-io (components/canvas/drawio-frame.tsx, Apache-2.0).
 */
export const DrawioFrame = forwardRef<DrawioFrameHandle, DrawioFrameProps>(
    function DrawioFrame({ src, onLoad, onAutoSave, onExport, onSave }, ref) {
        const iframeRef = useRef<HTMLIFrameElement>(null)
        // Handlers change on every render; the message listener reads refs
        const handlersRef = useRef({ onLoad, onAutoSave, onExport, onSave })
        handlersRef.current = { onLoad, onAutoSave, onExport, onSave }

        const drawioOrigin = () => new URL(src, window.location.href).origin

        const send = (action: string, data: Record<string, unknown> = {}) => {
            iframeRef.current?.contentWindow?.postMessage(
                JSON.stringify({ action, ...data }),
                drawioOrigin(),
            )
        }

        useImperativeHandle(ref, () => ({
            load: ({ xml }) => send("load", { xml, autosave: 1 }),
            exportDiagram: (data) => send("export", data),
        }))

        useEffect(() => {
            const iframe = iframeRef.current
            if (!iframe) return
            let editorUi: any = null

            // Watch for draw.io's scripts so the editor object is caught as
            // it starts. Stops once hooked, or when the frame turns out to be
            // cross-origin (then everything goes through postMessage).
            const startedAt = Date.now()
            const poll = setInterval(() => {
                const frameWindow = iframe.contentWindow as any
                if (!frameWindow) return
                let ready = false
                try {
                    ready =
                        frameWindow.location.href !== "about:blank" &&
                        !!frameWindow.EditorUi
                } catch {
                    clearInterval(poll)
                    return
                }
                if (ready) {
                    clearInterval(poll)
                    watchForEditorUi(frameWindow, (ui) => {
                        editorUi = ui
                    })
                } else if (Date.now() - startedAt > 60_000) {
                    clearInterval(poll)
                }
            }, 5)

            const attach = () => {
                if (!editorUi || !iframe.contentWindow) return false
                attachEditor(editorUi, iframe.contentWindow)
                return true
            }

            const handleMessage = (event: MessageEvent) => {
                if (event.source !== iframe.contentWindow) return
                if (event.origin !== drawioOrigin()) return
                if (typeof event.data !== "string") return
                let data: any
                try {
                    data = JSON.parse(event.data)
                } catch {
                    return
                }
                const handlers = handlersRef.current
                switch (data.event) {
                    case "init":
                        send("load", { xml: "", autosave: 1 })
                        break
                    case "load":
                        // Usually caught before the first load; else retry
                        // once, then stay on postMessage
                        if (!attach()) setTimeout(attach, 800)
                        handlers.onLoad?.()
                        break
                    case "autosave":
                        handlers.onAutoSave?.(data)
                        break
                    case "save":
                        // draw.io's Save button: export, then hand it to onSave
                        send("export", {
                            format: "xmlsvg",
                            parentEvent: "save",
                        })
                        break
                    case "export":
                        if (data.message?.parentEvent === "save") {
                            handlers.onSave?.()
                        }
                        handlers.onExport?.(data)
                        break
                }
            }

            window.addEventListener("message", handleMessage)
            return () => {
                clearInterval(poll)
                window.removeEventListener("message", handleMessage)
                detachEditor()
            }
        }, [src])

        return (
            <iframe
                ref={iframeRef}
                src={src}
                title="draw.io"
                allow="clipboard-read; clipboard-write"
                className="block h-full w-full border-0"
            />
        )
    },
)
