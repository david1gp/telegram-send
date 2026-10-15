import { expect, test } from "bun:test"
import { telegramTimerSummaryRender } from "../src/telegramTimerSummaryRender.js"

test("renders complete version transitions and links in plain text and HTML", () => {
  const url = `https://example.com/${"segment".repeat(40)}`
  const rendered = telegramTimerSummaryRender({ from: "1.0", to: "2.0", releaseUrl: url })

  expect(rendered.detailsText).toBe(`1.0 -> 2.0 Release: ${url}`)
  expect(rendered.detailsHtml).toBe(`1.0 -&gt; 2.0 <a href="${url}">Release</a>`)
})

test("renders all 50 batch items completely without shortening or omission markers", () => {
  const items = Array.from({ length: 50 }, (_, index) => ({
    name: `package-${index}-${"x".repeat(80)}`,
    from: "1.0.0",
    to: "2.0.0",
    compareUrl: `https://example.com/${index}/${"y".repeat(100)}`,
  }))
  const rendered = telegramTimerSummaryRender({ items })
  const textLines = rendered.detailsText.split("\n")
  const htmlLines = rendered.detailsHtml.split("\n")

  expect(textLines).toHaveLength(50)
  expect(htmlLines).toHaveLength(50)
  for (const [index, item] of items.entries()) {
    expect(textLines[index]).toBe(`${item.name}: 1.0.0 -> 2.0.0 Changes: ${item.compareUrl}`)
    expect(htmlLines[index]).toBe(`${item.name}: 1.0.0 -&gt; 2.0.0 <a href="${item.compareUrl}">Changes</a>`)
  }
})

test("keeps each item's links on its version line", () => {
  const compareUrl = "https://github.com/anomalyco/opencode/compare/v2.0.26...055d95bb7e27"
  const rendered = telegramTimerSummaryRender({
    name: "Open source repositories",
    items: [
      { name: "opencode", from: "v2.0.26", to: "github-v1.2.25-2160-g055d95bb7e27", compareUrl },
      { name: "hono", from: "v4.0.0", to: "v4.0.1", releaseUrl: "https://github.com/honojs/hono/releases/tag/v4.0.1" },
    ],
  })

  expect(rendered.detailsText.split("\n")).toEqual([
    `opencode: v2.0.26 -> github-v1.2.25-2160-g055d95bb7e27 Changes: ${compareUrl}`,
    "hono: v4.0.0 -> v4.0.1 Release: https://github.com/honojs/hono/releases/tag/v4.0.1",
  ])
  expect(rendered.detailsHtml.split("\n")).toEqual([
    `opencode: v2.0.26 -&gt; github-v1.2.25-2160-g055d95bb7e27 <a href="${compareUrl}">Changes</a>`,
    'hono: v4.0.0 -&gt; v4.0.1 <a href="https://github.com/honojs/hono/releases/tag/v4.0.1">Release</a>',
  ])
})

test("escapes ampersands, angle brackets, and quotes in HTML names and link URLs", () => {
  const rendered = telegramTimerSummaryRender({
    items: [
      {
        name: 'package & <beta> "quoted"',
        from: '1&<"',
        to: '2>"',
        releaseUrl: 'https://example.com/?a=1&b="<tag>"',
      },
    ],
  })

  expect(rendered.detailsText).toBe(
    'package & <beta> "quoted": 1&<" -> 2>" Release: https://example.com/?a=1&b="<tag>"',
  )
  expect(rendered.detailsHtml).toBe(
    'package &amp; &lt;beta&gt; &quot;quoted&quot;: 1&amp;&lt;&quot; -&gt; 2&gt;&quot; <a href="https://example.com/?a=1&amp;b=&quot;&lt;tag&gt;&quot;">Release</a>',
  )
})
