import type { CommandContext } from "@stricli/core"
import { telegramChatIdGet } from "./telegramChatIdGet.js"
import { telegramDocumentSend } from "./telegramDocumentSend.js"
import { telegramMessageSend } from "./telegramMessageSend.js"
import { telegramUpdatesGet } from "./telegramUpdatesGet.js"

type TgFlags = Readonly<{
  alert: boolean
  html: boolean
  limit?: number
  offset?: number
  timeout?: number
}>

type TgContext = CommandContext

function tgUsageError(message: string): Error {
  return new Error(`tg: ${message}`)
}

async function tgCommand(this: TgContext, flags: TgFlags, ...inputs: readonly string[]): Promise<Error | undefined> {
  if (inputs.length === 0) return tgUsageError("Usage: tg [--alert] [--html] MESSAGE")

  const [mode, ...rest] = inputs
  if (mode === "getUpdates" || mode === "getChatId") {
    const options = { limit: flags.limit, offset: flags.offset, timeout: flags.timeout }
    const result = mode === "getUpdates" ? await telegramUpdatesGet(options) : await telegramChatIdGet(options)
    if (!result.success) return new Error(`tg: ${result.errorMessage}`)
    const output = mode === "getUpdates" ? JSON.stringify(result.data) : result.data.map(String).join("\n")
    if (output.length > 0) this.process.stdout.write(`${output}\n`)
    return undefined
  }

  if (mode === "document" || mode === "sendDocument") {
    const [file, ...caption] = rest
    if (!file) return tgUsageError("Usage: tg [--alert] [--html] document FILE [CAPTION]")
    const result = await telegramDocumentSend({
      alert: flags.alert,
      caption: caption.join(" "),
      file,
      html: flags.html,
    })
    if (!result.success) return new Error(`tg: ${result.errorMessage}`)
    return
  }

  const result = await telegramMessageSend({
    alert: flags.alert,
    html: flags.html,
    message: inputs.join(" "),
  })
  if (!result.success) return new Error(`tg: ${result.errorMessage}`)
  return undefined
}

export { tgCommand }
