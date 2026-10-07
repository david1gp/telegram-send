import { expect, test } from "bun:test"
import { telegramTimerSummaryRender } from "../src/telegramTimerSummaryRender.js"

function expectBounded(rendered: ReturnType<typeof telegramTimerSummaryRender>, maxLength: number): void {
  expect(rendered.detailsText.length).toBeLessThanOrEqual(maxLength)
  expect(rendered.detailsHtml.length).toBeLessThanOrEqual(maxLength)
}

test("bounds an oversized first line without cutting escaped HTML entities", () => {
  const rendered = telegramTimerSummaryRender({ from: `v&${"x".repeat(300)}`, to: "next" }, 31)

  expectBounded(rendered, 31)
  expect(rendered.detailsText.length).toBeGreaterThan(0)
  expect(rendered.detailsHtml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|#\d+;|#x[\da-f]+;)/i)
})

test("keeps long URLs as complete safe HTML links and fits the summary marker", () => {
  const url = `https://example.com/${"segment".repeat(40)}`
  const rendered = telegramTimerSummaryRender({ from: "1.0", to: "2.0", releaseUrl: url }, 40)

  expectBounded(rendered, 40)
  expect(rendered.detailsText).toContain("1.0 -> 2.0")
  expect(rendered.detailsHtml).toContain("1.0 -&gt; 2.0")
  expect(rendered.detailsHtml).not.toContain("<a ")
  expect(rendered.detailsText).toContain("summary shortened")
})

test("bounds large batches and handles tiny and zero limits without exceeding them", () => {
  const rendered = telegramTimerSummaryRender(
    {
      items: Array.from({ length: 50 }, (_, index) => ({
        name: `package-${index}-${"x".repeat(80)}`,
        from: "1.0.0",
        to: "2.0.0",
        compareUrl: `https://example.com/${index}/${"y".repeat(100)}`,
      })),
    },
    120,
  )

  expectBounded(rendered, 120)
  expect(rendered.detailsText).toContain("package-0")
  expect(rendered.detailsHtml).toContain("package-0")
  expect(rendered.detailsText).toContain("summary shortened")
  expect(rendered.detailsHtml).toContain("summary shortened")

  for (const maxLength of [0, 1, 5, 21, 22, 23]) {
    const tiny = telegramTimerSummaryRender(
      { from: "1.0", to: "2.0", releaseUrl: "https://example.com/release" },
      maxLength,
    )
    expectBounded(tiny, maxLength)
    if (maxLength > 0) expect(tiny.detailsText.length).toBeGreaterThan(0)
  }
})
