import { expect, test } from "@playwright/test"
import { addReplyUsage } from "@/lib/reply-usage"
import { mockChat, openApp, sendAndWait } from "./helpers"

/** Each answer's tokens and time, under it */

test("a turn's requests add up into one usage", () => {
    const first = addReplyUsage(
        undefined,
        {
            inputTokens: 9000,
            outputTokens: 100,
            totalTokens: 9100,
            inputTokenDetails: { cacheReadTokens: 8000 },
            outputTokenDetails: { reasoningTokens: 40 },
        } as never,
        3000,
    )
    const second = addReplyUsage(
        first,
        {
            inputTokens: 3200,
            outputTokens: 30,
            totalTokens: 3230,
            inputTokenDetails: {},
            outputTokenDetails: {},
        } as never,
        2400,
    )
    expect(second).toEqual({
        inputTokens: 12200,
        outputTokens: 130,
        cacheReadTokens: 8000,
        reasoningTokens: 40,
        durationMs: 5400,
    })
    // A request without usage adds nothing
    expect(
        addReplyUsage(
            second,
            { inputTokens: undefined, outputTokens: undefined } as never,
            900,
        ),
    ).toBe(second)
})

test("the answer shows its tokens and time, with details on pointing", async ({
    page,
}) => {
    const usage = {
        inputTokens: 12200,
        outputTokens: 130,
        cacheReadTokens: 8000,
        reasoningTokens: 40,
        durationMs: 5400,
    }
    await mockChat(page, [
        [
            { chunk: { type: "start" } },
            { chunk: { type: "text-start", id: "t" } },
            { chunk: { type: "text-delta", id: "t", delta: "Done." } },
            { chunk: { type: "text-end", id: "t" } },
            {
                chunk: {
                    type: "finish",
                    messageMetadata: { finishReason: "stop", usage },
                },
            },
        ],
    ])
    await openApp(page)
    await sendAndWait(page, "hello")
    const note = page.getByTestId("reply-usage")
    await expect(note).toHaveText("In 12.2K · Out 130 · 5s")
    await note.hover()
    await expect(page.getByRole("tooltip")).toContainText("From cache")
    await expect(page.getByRole("tooltip")).toContainText("8,000")
    // Kept with the chat
    await page.reload()
    await expect(page.getByTestId("reply-usage")).toHaveText(
        "In 12.2K · Out 130 · 5s",
        { timeout: 30_000 },
    )
})
