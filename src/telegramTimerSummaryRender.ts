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

type SummaryLine = Readonly<{ base: string; links: readonly string[] }>

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

/** Keep each item's links on its version line so one update reads as one line. */
function summaryLineJoin(line: SummaryLine): string {
  return [line.base, ...line.links].filter(Boolean).join(" ")
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

function summaryBound(lines: readonly SummaryLine[], maxLength: number): string[] {
  const bound = Math.max(0, Math.floor(maxLength))
  if (bound === 0) return []
  const joined = lines.map(summaryLineJoin).filter(Boolean)
  const totalLength = joined.reduce((length, line, index) => length + line.length + (index > 0 ? 1 : 0), 0)
  if (totalLength <= bound) return joined

  const marker = "… (summary shortened)"
  const canShowMarker = marker.length + 2 <= bound
  const contentLimit = canShowMarker ? Math.max(0, bound - marker.length - 1) : bound
  const result: string[] = []
  let used = 0
  for (const line of lines) {
    const full = summaryLineJoin(line)
    if (!full) continue
    const separator = result.length > 0 ? 1 : 0
    const remaining = contentLimit - used - separator
    if (remaining <= 0) break
    if (full.length <= remaining) {
      result.push(full)
      used += separator + full.length
      continue
    }
    // Links are atomic: truncating their URL can make the rendered destination misleading,
    // so an overflowing line keeps its version text and drops the links instead.
    const prefix = line.base.length <= remaining ? line.base : summaryTextPrefix(line.base, remaining)
    if (prefix) {
      result.push(prefix)
      used += separator + prefix.length
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
  const itemText = (item: TelegramTimerSummaryItem) =>
    batchItems.length > 0 ? summaryItemLine(item) : [item.from, item.to].filter(Boolean).join(" -> ")
  const plainLines: SummaryLine[] = targets.map((item) => ({ base: itemText(item), links: summaryLinks(item) }))
  const htmlLines: SummaryLine[] = targets.map((item) => ({
    base: summaryHtmlEscape(itemText(item)),
    links: summaryLinkHtml(item),
  }))
  if (batchItems.length > 0) {
    plainLines.push({ base: "", links: summaryLinks(summary) })
    htmlLines.push({ base: "", links: summaryLinkHtml(summary) })
  }
  const boundedText = summaryBound(plainLines, maxLength)
  const boundedHtml = summaryBound(htmlLines, maxLength)
  return {
    detailsHtml: boundedHtml.join("\n"),
    detailsText: boundedText.join("\n"),
    title,
    titleHtml: summaryHtmlEscape(title),
  }
}

export type { TelegramTimerSummaryRender }
export { telegramTimerSummaryRender }
