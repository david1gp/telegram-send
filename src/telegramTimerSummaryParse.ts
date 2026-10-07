type TelegramTimerSummaryItem = Readonly<{
  name?: string
  from?: string
  to?: string
  releaseUrl?: string
  changelogUrl?: string
  compareUrl?: string
}>

type TelegramTimerSummary = TelegramTimerSummaryItem & Readonly<{ items?: readonly TelegramTimerSummaryItem[] }>

const maxFieldLength = 300
const maxItems = 50

function summaryObjectValue(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function summaryTextValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const text = value
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, maxFieldLength)
  return text || undefined
}

function summaryUrlValue(value: unknown): string | undefined {
  const text = summaryTextValue(value)
  if (!text) return undefined
  try {
    const url = new URL(text)
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined
    if (!url.hostname || url.username || url.password) return undefined
    return url.href
  } catch {
    return undefined
  }
}

function summaryItemParse(value: unknown): TelegramTimerSummaryItem | undefined {
  const object = summaryObjectValue(value)
  if (!object) return undefined
  const item: {
    name?: string
    from?: string
    to?: string
    releaseUrl?: string
    changelogUrl?: string
    compareUrl?: string
  } = {}
  const textAliases = {
    from: ["oldVersion", "old_version"],
    to: ["newVersion", "new_version"],
  } as const
  const urlAliases = {
    releaseUrl: ["release_url", "url"],
  } as const
  for (const key of ["name", "from", "to"] as const) {
    const raw =
      object[key] ??
      (key === "name" ? undefined : textAliases[key].map((alias) => object[alias]).find((value) => value !== undefined))
    const parsed = summaryTextValue(raw)
    if (parsed) item[key] = parsed
  }
  for (const key of ["releaseUrl", "changelogUrl", "compareUrl"] as const) {
    const raw =
      object[key] ??
      (key === "releaseUrl"
        ? urlAliases.releaseUrl.map((alias) => object[alias]).find((value) => value !== undefined)
        : undefined)
    const parsed = summaryUrlValue(raw)
    if (parsed) item[key] = parsed
  }
  return Object.keys(item).length > 0 ? item : undefined
}

function telegramTimerSummaryParse(stdout: string): TelegramTimerSummary | undefined {
  const records: { summary?: TelegramTimerSummaryItem; items: readonly TelegramTimerSummaryItem[] }[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const marker = line.match(/^\s*UPDATE_SUMMARY=(.*)$/)
    if (!marker?.[1]) continue
    try {
      const object = summaryObjectValue(JSON.parse(marker[1]))
      if (!object) continue
      const summary = summaryItemParse(object)
      const items = Array.isArray(object.items)
        ? object.items
            .slice(0, maxItems)
            .map(summaryItemParse)
            .filter((item) => item !== undefined)
        : []
      if (!summary && items.length === 0) continue
      records.push({ summary, items })
    } catch {
      // Malformed structured output is ignored; the regular summary and failure report remain available.
    }
  }
  if (records.length === 0) return undefined
  if (records.length === 1) {
    const [record] = records
    return { ...(record?.summary ?? {}), ...(record?.items.length ? { items: record.items } : {}) }
  }
  const items = records.flatMap(({ summary, items: recordItems }) => [
    ...(summary ? [{ ...(summary.name ? {} : { name: "Unnamed update" }), ...summary }] : []),
    ...recordItems.map((item) => ({ ...(item.name ? {} : { name: "Unnamed update" }), ...item })),
  ])
  return items.length > 0 ? { items } : undefined
}

export type { TelegramTimerSummary, TelegramTimerSummaryItem }
export { telegramTimerSummaryParse }
