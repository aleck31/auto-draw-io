import fs from "node:fs"
import { E2E_STORE_DIR } from "../../playwright.config"

/** Each run starts with an empty diagram store */
export default function globalSetup() {
    fs.rmSync(E2E_STORE_DIR, { recursive: true, force: true })
}
