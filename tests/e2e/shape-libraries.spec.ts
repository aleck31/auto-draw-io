import { execFileSync } from "node:child_process"
import { expect, test } from "@playwright/test"

/** The icon lists get_shape_library serves match the bundled draw.io */
test("the shape library lists are up to date with the bundled draw.io", () => {
    test.setTimeout(120_000)
    let output = ""
    try {
        execFileSync(
            process.execPath,
            ["scripts/shape-libraries.mjs", "--check"],
            {
                encoding: "utf8",
                stdio: "pipe",
            },
        )
    } catch (error) {
        output = `${(error as { stdout?: string }).stdout ?? ""}${(error as { stderr?: string }).stderr ?? ""}`
    }
    expect(output).toBe("")
})
