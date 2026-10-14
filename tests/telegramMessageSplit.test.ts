import { describe, expect, test } from "bun:test"
import { telegramMessageSplit } from "../src/telegramMessageSplit.js"

describe("telegramMessageSplit", () => {
  test("returns single chunk when text is within limit", () => {
    const text = "Hello world"
    expect(telegramMessageSplit(text, 4096)).toEqual([text])
  })

  test("returns empty array for empty string", () => {
    expect(telegramMessageSplit("", 4096)).toEqual([])
  })

  test("splits on paragraph double newlines when available", () => {
    const p1 = "First paragraph content."
    const p2 = "Second paragraph content."
    const text = `${p1}\n\n${p2}`
    const chunks = telegramMessageSplit(text, 30)
    expect(chunks).toEqual([p1, p2])
  })

  test("splits on single newlines when a paragraph exceeds limit", () => {
    const line1 = "Line one of the paragraph."
    const line2 = "Line two of the paragraph."
    const text = `${line1}\n${line2}`
    const chunks = telegramMessageSplit(text, 30)
    expect(chunks).toEqual([line1, line2])
  })

  test("splits on space boundaries when a single line exceeds limit", () => {
    const text = "word1 word2 word3 word4 word5"
    const chunks = telegramMessageSplit(text, 15)
    expect(chunks).toEqual(["word1 word2", "word3 word4", "word5"])
  })

  test("splits long strings without break boundaries into hard-capped character slices", () => {
    const text = "abcdefghij"
    const chunks = telegramMessageSplit(text, 4)
    expect(chunks).toEqual(["abcd", "efgh", "ij"])
  })

  test("closes and reopens HTML tags across chunk boundaries without corrupting markup", () => {
    const p1 = "Paragraph 1 with <b>bold text that is somewhat long</b>"
    const p2 = "Paragraph 2 with <code>code snippet here</code>"
    const text = `<b>${p1}\n\n${p2}</b>`
    const chunks = telegramMessageSplit(text, 60, true)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(60)
      const bOpen = (chunk.match(/<b>/g) || []).length
      const bClose = (chunk.match(/<\/b>/g) || []).length
      expect(bOpen).toBe(bClose)
    }
  })

  test("never cuts inside an HTML entity when limit allows full entity", () => {
    const text = "a&amp;b"
    const chunks = telegramMessageSplit(text, 5, true)
    for (const chunk of chunks) {
      expect(chunk).not.toMatch(/&[a-z0-9#]*$/i)
    }
    expect(chunks).toEqual(["a", "&amp;", "b"])
  })
})
