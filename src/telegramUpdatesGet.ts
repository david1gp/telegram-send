import type { Result } from "#result"
import { createResult, createResultError } from "#result"
import { telegramApiRequestSend } from "./telegramApiRequestSend.js"
import type { TelegramBotConfiguration } from "./telegramBotConfigurationSchema.js"
import { telegramConfigurationLoad } from "./telegramConfigurationLoad.js"
import type { TelegramFetch } from "./telegramSendRuntimeOptions.js"

type TelegramChatId = number | string
type TelegramChat = Readonly<{
  id: TelegramChatId
}>
type TelegramMessage = Readonly<{
  chat: TelegramChat
}>
type TelegramCallbackQuery = Readonly<{
  message?: TelegramMessage
}>
type TelegramUpdate = Readonly<{
  callback_query?: TelegramCallbackQuery
  channel_post?: TelegramMessage
  chat_member?: Readonly<{ chat: TelegramChat }>
  edited_channel_post?: TelegramMessage
  edited_message?: TelegramMessage
  message?: TelegramMessage
  my_chat_member?: Readonly<{ chat: TelegramChat }>
  update_id: number
  [key: string]: unknown
}>
type TelegramUpdatesGetOptions = Readonly<{
  configuration?: TelegramBotConfiguration
  env?: Readonly<Record<string, string | undefined>>
  envFile?: string
  fetch?: TelegramFetch
  limit?: number
  offset?: number
  signal?: AbortSignal
  timeout?: number
}>

function telegramUpdateIs(input: unknown): input is TelegramUpdate {
  return (
    typeof input === "object" &&
    input !== null &&
    "update_id" in input &&
    typeof input.update_id === "number" &&
    Number.isInteger(input.update_id)
  )
}

async function telegramUpdatesGet(options: TelegramUpdatesGetOptions = {}): Promise<Result<readonly TelegramUpdate[]>> {
  const op = "telegramUpdatesGet"
  if (options.offset !== undefined && !Number.isInteger(options.offset))
    return createResultError(op, "offset must be an integer")
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100))
    return createResultError(op, "limit must be an integer between 1 and 100")
  if (
    options.timeout !== undefined &&
    (!Number.isInteger(options.timeout) || options.timeout < 0 || options.timeout > 50)
  )
    return createResultError(op, "timeout must be an integer between 0 and 50")

  const configuration = options.configuration
    ? createResult(options.configuration)
    : await telegramConfigurationLoad({ chatIdRequired: false, env: options.env, envFile: options.envFile })
  if (!configuration.success) return createResultError(op, configuration.errorMessage)

  const body = new URLSearchParams()
  if (options.offset !== undefined) body.set("offset", String(options.offset))
  if (options.limit !== undefined) body.set("limit", String(options.limit))
  if (options.timeout !== undefined) body.set("timeout", String(options.timeout))
  const response = await telegramApiRequestSend({
    body,
    botToken: configuration.data.botToken,
    fetch: options.fetch,
    method: "getUpdates",
    signal: options.signal,
    timeoutMilliseconds: Math.max(30_000, ((options.timeout ?? 0) + 10) * 1_000),
  })
  if (!response.success) return createResultError(op, `getUpdates failed: ${response.errorMessage}`)

  if (
    typeof response.data !== "object" ||
    response.data === null ||
    !("result" in response.data) ||
    !Array.isArray(response.data.result) ||
    !response.data.result.every(telegramUpdateIs)
  ) {
    return createResultError(op, "getUpdates returned an invalid response")
  }
  return createResult(response.data.result)
}

export type {
  TelegramCallbackQuery,
  TelegramChat,
  TelegramChatId,
  TelegramMessage,
  TelegramUpdate,
  TelegramUpdatesGetOptions,
}
export { telegramUpdatesGet }
