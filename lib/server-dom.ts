/**
 * DOMParser and XMLSerializer for server code. The XML helpers in lib/utils.ts
 * and lib/diagram-pages.ts are written against the browser's DOM; jsdom gives
 * Node the same behaviour, including a <parsererror> element whose text
 * starts with "line:column:", which the validation and repair steps read.
 * Importing this module installs them once; in the browser it does nothing.
 */
import { JSDOM } from "jsdom"

if (typeof globalThis.DOMParser === "undefined") {
    const { window } = new JSDOM("")
    globalThis.DOMParser = window.DOMParser
    globalThis.XMLSerializer = window.XMLSerializer
}
