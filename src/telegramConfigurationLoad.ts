import { readFile as readFileDefault } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import * as v from "valibot"
import type { Result } from "#result"
import { createResult, createResultError } from "#result"
import { type TelegramConfiguration, telegramConfigurationSchema } from "./telegramConfigurationSchema.js"

type TelegramEnvironment = Readonly<Record<string, string | undefined>>
type TelegramConfigurationLoadOptions = Readonly<{
  env?: TelegramEnvironment
  envFile?: string
  readFile?: (path: string, encoding: "utf8") => Promise<string>
}>

function telegramEnvironmentFileValueParse(input: string): string | undefined {
  const value = input.trim()
  if (value.length === 0) return ""
  const quote = value[0]
  if (quote !== "'" && quote !== '"') return value.replace(/\s+#.*$/, "").trim()
  if (!value.endsWith(quote)) return undefined
  return value.slice(1, -1)
}

function telegramEnvironmentFileParse(text: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const input = line.trim()
    if (input.length === 0 || input.startsWith("#")) continue
    const assignment = input.startsWith("export ") ? input.slice(7).trim() : input
    const separator = assignment.indexOf("=")
    if (separator <= 0) continue
    const key = assignment.slice(0, separator).trim()
    if (key !== "TELEGRAM_BOT_TOKEN" && key !== "TELEGRAM_CHAT_ID") continue
    const value = telegramEnvironmentFileValueParse(assignment.slice(separator + 1))
    if (value !== undefined) values[key] = value
  }
  return values
}

function telegramEnvironmentFilePathResolve(env: TelegramEnvironment, envFile?: string): string {
  if (envFile) return envFile
  if (env.TG_ENV_FILE) return env.TG_ENV_FILE
  return join(env.HOME ?? homedir(), ".config", "timers", "telegram.env")
}

async function telegramConfigurationLoad(
  options: TelegramConfigurationLoadOptions = {},
): Promise<Result<TelegramConfiguration>> {
  const op = "telegramConfigurationLoad"
  const env = options.env ?? process.env
  const envFile = telegramEnvironmentFilePathResolve(env, options.envFile)
  let fileText: string
  try {
    fileText = await (options.readFile ?? readFileDefault)(envFile, "utf8")
  } catch {
    return createResultError(op, `Telegram environment file is not readable: ${envFile}`)
  }

  const fileValues = telegramEnvironmentFileParse(fileText)
  const parsed = v.safeParse(telegramConfigurationSchema, {
    botToken: fileValues.TELEGRAM_BOT_TOKEN ?? env.TELEGRAM_BOT_TOKEN,
    chatId: fileValues.TELEGRAM_CHAT_ID ?? env.TELEGRAM_CHAT_ID,
  })
  if (!parsed.success) {
    return createResultError(op, `TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required in ${envFile}`)
  }
  return createResult(parsed.output)
}

export type { TelegramConfigurationLoadOptions, TelegramEnvironment }
export { telegramConfigurationLoad }
