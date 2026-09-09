import type { Result } from "#result"
import { createResult, createResultError } from "#result"
import type { TelegramFetch } from "./telegramSendRuntimeOptions.js"

type TelegramApiRequestSendOptions = Readonly<{
  botToken: string
  body: string | URLSearchParams | FormData
  fetch?: TelegramFetch
  method: "sendMessage" | "sendDocument"
  signal?: AbortSignal
  timeoutMilliseconds: number
}>

async function telegramApiRequestSend(options: TelegramApiRequestSendOptions): Promise<Result<unknown>> {
  const op = "telegramApiRequestSend"
  const fetcher = options.fetch ?? globalThis.fetch?.bind(globalThis)
  if (!fetcher) return createResultError(op, "A fetch implementation is required")

  const controller = options.signal ? undefined : new AbortController()
  const timeout = controller ? setTimeout(() => controller.abort(), options.timeoutMilliseconds) : undefined
  let response: Response
  try {
    response = await fetcher(`https://api.telegram.org/bot${options.botToken}/${options.method}`, {
      method: "POST",
      body: options.body,
      signal: options.signal ?? controller?.signal,
    })
  } catch {
    if (timeout) clearTimeout(timeout)
    return createResultError(op, "Unable to reach Telegram API")
  }
  if (timeout) clearTimeout(timeout)

  let body: string
  try {
    body = await response.text()
  } catch {
    return createResultError(op, "Unable to read Telegram API response")
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return createResultError(op, body.trim() || `HTTP ${response.status} ${response.statusText}`)
  }

  if (response.ok && typeof parsed === "object" && parsed !== null && "ok" in parsed && parsed.ok === true)
    return createResult(parsed)

  const description =
    typeof parsed === "object" && parsed !== null && "description" in parsed && typeof parsed.description === "string"
      ? parsed.description
      : body.trim() || `HTTP ${response.status} ${response.statusText}`
  return createResultError(op, description, body)
}

export type { TelegramApiRequestSendOptions }
export { telegramApiRequestSend }
