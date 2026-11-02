/**
 * The page the AI reads and writes: the page the user is viewing when they
 * send a message, kept for the whole turn (the user may switch pages while
 * the model works). Without a same-origin editor the page is unknown and the
 * first page is used, as pageModelXml and placeOnPage do for a null id.
 */
import { listPages, pageModelXml, placeOnPage } from "@/lib/diagram-pages"
import { currentPageId } from "@/lib/drawio-bridge"

let aiPageId: string | null = null

/** At the start of a turn: the page on screen becomes the AI's page */
export function startAiPageTurn(): void {
    aiPageId = currentPageId()
}

export function getAiPageId(): string | null {
    return aiPageId
}

/** The AI's page of a document as an <mxGraphModel> */
export function aiPageModel(xml: string): string | null {
    return pageModelXml(xml, aiPageId)
}

/** A drawn page (a one-page file or a model) put on the AI's page of the canvas */
export function placeOnAiPage(drawnXml: string, canvasXml: string): string {
    return placeOnPage(drawnXml, canvasXml, aiPageId)
}

/** What the model is told about the canvas: its page, and the file's pages */
export function aiCanvasContext(xml: string): {
    xml: string
    pages?: string[]
    page?: number
} {
    const pages = listPages(xml)
    const index = Math.max(
        0,
        pages.findIndex((page) => page.id === aiPageId),
    )
    return {
        xml: aiPageModel(xml) ?? xml,
        ...(pages.length > 1 && {
            pages: pages.map((page) => page.name),
            page: index + 1,
        }),
    }
}
