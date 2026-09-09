import type { Result } from "#result"
import { createResult, createResultError } from "#result"
import { telegramApiRequestSend } from "./telegramApiRequestSend.js"
import { telegramConfigurationLoad } from "./telegramConfigurationLoad.js"
import type { TelegramSendRuntimeOptions } from "./telegramSendRuntimeOptions.js"

type TelegramMessageSendOptions = TelegramSendRuntimeOptions &
  Readonly<{
    alert?: boolean
    html?: boolean
    message: string
  }>

async function telegramMessageSend(options: TelegramMessageSendOptions): Promise<Result<unknown>> {
  const op = "telegramMessageSend"
  const configuration = options.configuration
    ? createResult(options.configuration)
    : await telegramConfigurationLoad({ env: options.env, envFile: options.envFile })
  if (!configuration.success) return createResultError(op, configuration.errorMessage)

  const body = new URLSearchParams({
    chat_id: configuration.data.chatId,
    text: options.message,
    disable_notification: String(!(options.alert ?? false)),
    disable_web_page_preview: "true",
  })
  if (options.html) body.set("parse_mode", "HTML")

  const response = await telegramApiRequestSend({
    botToken: configuration.data.botToken,
    body,
    fetch: options.fetch,
    method: "sendMessage",
    signal: options.signal,
    timeoutMilliseconds: 30_000,
  })
  if (!response.success) return createResultError(op, `sendMessage failed: ${response.errorMessage}`)
  return createResult(response.data)
}

export type { TelegramMessageSendOptions }
export { telegramMessageSend }
