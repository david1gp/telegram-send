import type { TelegramConfiguration } from "./telegramConfigurationSchema.js"

type TelegramFetch = (input: string | URL, init?: RequestInit) => Promise<Response>
type TelegramSendRuntimeOptions = Readonly<{
  configuration?: TelegramConfiguration
  env?: Readonly<Record<string, string | undefined>>
  envFile?: string
  fetch?: TelegramFetch
  signal?: AbortSignal
}>

export type { TelegramFetch, TelegramSendRuntimeOptions }
