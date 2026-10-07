import { expect, test } from "bun:test"
import { telegramTimerSummaryParse } from "../src/telegramTimerSummaryParse.js"

test("accepts the version and release URL aliases used by the timer summary resolver", () => {
  const summary = telegramTimerSummaryParse(
    'UPDATE_SUMMARY={"name":"runtime","oldVersion":"1.0","new_version":"2.0","release_url":"https://example.com/release"}',
  )

  expect(summary).toEqual({
    name: "runtime",
    from: "1.0",
    to: "2.0",
    releaseUrl: "https://example.com/release",
  })
})

test("aggregates multiple summary records and preserves their fields and nested items", () => {
  const summary = telegramTimerSummaryParse(
    [
      'UPDATE_SUMMARY={"name":"runtime","old_version":"1.0","to":"2.0","compareUrl":"https://example.com/runtime/compare","items":[{"name":"runtime-plugin","from":"3","to":"4"}]}',
      "UPDATE_SUMMARY={malformed}",
      'UPDATE_SUMMARY={"releaseUrl":"https://example.com/tool","from":"5","to":"6"}',
    ].join("\n"),
  )

  expect(summary).toEqual({
    items: [
      {
        name: "runtime",
        from: "1.0",
        to: "2.0",
        compareUrl: "https://example.com/runtime/compare",
      },
      { name: "runtime-plugin", from: "3", to: "4" },
      {
        name: "Unnamed update",
        from: "5",
        to: "6",
        releaseUrl: "https://example.com/tool",
      },
    ],
  })
})

test("retains the original single-record shape and ignores malformed records", () => {
  expect(
    telegramTimerSummaryParse(
      [
        "UPDATE_SUMMARY={invalid}",
        'UPDATE_SUMMARY={"name":"package","to":"2","items":[{"name":"dependency","to":"3"}]}',
      ].join("\n"),
    ),
  ).toEqual({ name: "package", to: "2", items: [{ name: "dependency", to: "3" }] })
  expect(telegramTimerSummaryParse("UPDATE_SUMMARY={invalid}")).toBeUndefined()
})
