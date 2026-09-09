import { readFile } from "node:fs/promises"
import { basename } from "node:path"
import type { Result } from "#result"
import { createResult, createResultError } from "#result"
import { telegramApiRequestSend } from "./telegramApiRequestSend.js"
import { telegramConfigurationLoad } from "./telegramConfigurationLoad.js"
import type { TelegramSendRuntimeOptions } from "./telegramSendRuntimeOptions.js"

type TelegramDocumentSendOptions = TelegramSendRuntimeOptions &
  Readonly<{
    alert?: boolean
    caption?: string
    file: string
    html?: boolean
  }>

async function telegramDocumentSend(options: TelegramDocumentSendOptions): Promise<Result<unknown>> {
  const op = "telegramDocumentSend"
  const configuration = options.configuration
    ? createResult(options.configuration)
    : await telegramConfigurationLoad({ env: options.env, envFile: options.envFile })
  if (!configuration.success) return createResultError(op, configuration.errorMessage)

  let contents: Buffer
  try {
    contents = await readFile(options.file)
  } catch {
    return createResultError(op, `document is not readable: ${options.file}`)
  }

  const form = new FormData()
  form.set("chat_id", configuration.data.chatId)
  form.set("document", new Blob([contents]), basename(options.file))
  form.set("disable_notification", String(!(options.alert ?? false)))
  form.set("caption", options.caption ?? "")
  if (options.html) form.set("parse_mode", "HTML")

  const response = await telegramApiRequestSend({
    botToken: configuration.data.botToken,
    body: form,
    fetch: options.fetch,
    method: "sendDocument",
    signal: options.signal,
    timeoutMilliseconds: 60_000,
  })
  if (!response.success) return createResultError(op, `sendDocument failed: ${response.errorMessage}`)
  return createResult(response.data)
}

export type { TelegramDocumentSendOptions }
export { telegramDocumentSend }
