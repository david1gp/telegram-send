import type { TelegramTimerSummary, TelegramTimerSummaryItem } from "./telegramTimerSummaryParse.js"

type TelegramTimerSummaryRender = Readonly<{
  detailsHtml: string
  detailsText: string
  title: string
  titleHtml: string
}>

function summaryHtmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
}

function summaryItemLine(item: TelegramTimerSummaryItem): string {
  const transition = item.from || item.to ? `${item.from ?? "?"} -> ${item.to ?? "?"}` : ""
  return [item.name, transition].filter(Boolean).join(": ")
}

function summaryLinks(item: TelegramTimerSummaryItem): readonly string[] {
  return [
    ...(item.releaseUrl ? [`Release: ${item.releaseUrl}`] : []),
    ...(item.changelogUrl ? [`Changelog: ${item.changelogUrl}`] : []),
    ...(item.compareUrl ? [`Changes: ${item.compareUrl}`] : []),
  ]
}

function summaryLinkHtml(item: TelegramTimerSummaryItem): readonly string[] {
  return [
    ...(item.releaseUrl ? [`<a href="${summaryHtmlEscape(item.releaseUrl)}">Release</a>`] : []),
    ...(item.changelogUrl ? [`<a href="${summaryHtmlEscape(item.changelogUrl)}">Changelog</a>`] : []),
    ...(item.compareUrl ? [`<a href="${summaryHtmlEscape(item.compareUrl)}">Changes</a>`] : []),
  ]
}

function summaryTextPrefix(value: string, maxLength: number): string {
  const tokens = value.match(/&(?:#\d+|#x[\da-f]+|[a-z]+);|./giu) ?? []
  let result = ""
  for (const token of tokens) {
    if (result.length + token.length > maxLength) break
    result += token
  }
  return result
}

function summaryBound(lines: readonly string[], maxLength: number, html: boolean): string[] {
  const bound = Math.max(0, Math.floor(maxLength))
  if (bound === 0) return []
  const totalLength = lines.reduce((length, line, index) => length + line.length + (index > 0 ? 1 : 0), 0)
  if (totalLength <= bound) return [...lines]

  const marker = "… (summary shortened)"
  const canShowMarker = marker.length + 2 <= bound
  const contentLimit = canShowMarker ? Math.max(0, bound - marker.length - 1) : bound
  const result: string[] = []
  let used = 0
  for (const line of lines) {
    const separator = result.length > 0 ? 1 : 0
    const remaining = contentLimit - used - separator
    if (remaining <= 0) break
    if (line.length <= remaining) {
      result.push(line)
      used += separator + line.length
      continue
    }
    // Links are atomic: truncating their URL can make the rendered destination misleading.
    const canTruncate = !html || !line.includes("<a ")
    if (canTruncate) {
      const prefix = summaryTextPrefix(line, remaining)
      if (prefix) {
        result.push(prefix)
        used += separator + prefix.length
      }
    }
    break
  }
  if (canShowMarker) result.push(marker)
  return result
}

function telegramTimerSummaryRender(summary: TelegramTimerSummary, maxLength = 650): TelegramTimerSummaryRender {
  const batchItems = summary.items ?? []
  const title = summary.name ?? (batchItems.length > 0 ? `${batchItems.length} changes` : "Update")
  const targets = batchItems.length > 0 ? batchItems : [summary]
  const plainLines = targets.flatMap((item) => {
    const line = batchItems.length > 0 ? summaryItemLine(item) : [item.from, item.to].filter(Boolean).join(" -> ")
    return [...(line ? [line] : []), ...summaryLinks(item)]
  })
  const htmlLines = targets.flatMap((item) => {
    const line = batchItems.length > 0 ? summaryItemLine(item) : [item.from, item.to].filter(Boolean).join(" -> ")
    return [...(line ? [summaryHtmlEscape(line)] : []), ...summaryLinkHtml(item)]
  })
  if (batchItems.length > 0) {
    plainLines.push(...summaryLinks(summary))
    htmlLines.push(...summaryLinkHtml(summary))
  }
  const boundedText = summaryBound(plainLines, maxLength, false)
  const boundedHtml = summaryBound(htmlLines, maxLength, true)
  return {
    detailsHtml: boundedHtml.join("\n"),
    detailsText: boundedText.join("\n"),
    title,
    titleHtml: summaryHtmlEscape(title),
  }
}

export type { TelegramTimerSummaryRender }
export { telegramTimerSummaryRender }
