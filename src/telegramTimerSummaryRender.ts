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

function telegramTimerSummaryRender(summary: TelegramTimerSummary): TelegramTimerSummaryRender {
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
  return {
    detailsHtml: htmlLines.map(summaryLineJoin).filter(Boolean).join("\n"),
    detailsText: plainLines.map(summaryLineJoin).filter(Boolean).join("\n"),
    title,
    titleHtml: summaryHtmlEscape(title),
  }
}

export type { TelegramTimerSummaryRender }
export { telegramTimerSummaryRender }
