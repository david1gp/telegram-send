#!/usr/bin/env bun

import { buildApplication, buildCommand, type CommandContext, help, run, version } from "@stricli/core"
import { telegramDocumentSend } from "./telegramDocumentSend.js"
import { telegramMessageSend } from "./telegramMessageSend.js"

type TgFlags = Readonly<{
  alert: boolean
  html: boolean
}>

type TgContext = CommandContext

function tgUsageError(message: string): Error {
  return new Error(`tg: ${message}`)
}

async function tgCommand(this: TgContext, flags: TgFlags, ...inputs: readonly string[]): Promise<Error | undefined> {
  if (inputs.length === 0) return tgUsageError("Usage: tg [--alert] [--html] MESSAGE")

  const [mode, ...rest] = inputs
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

const tgCommandDefinition = buildCommand<TgFlags, readonly string[], TgContext>({
  func: tgCommand,
  parameters: {
    flags: {
      alert: { kind: "boolean", brief: "Send with notifications enabled", withNegated: false },
      html: { kind: "boolean", brief: "Parse message or caption as HTML", withNegated: false },
    },
    positional: {
      kind: "array",
      parameter: {
        brief: "Message text or document command",
        parse: (input: string) => input,
        placeholder: "MESSAGE",
      },
      minimum: 1,
    },
  },
  docs: {
    brief: "Send a Telegram message or document",
    customUsage: ["[--alert] [--html] MESSAGE", "[--alert] [--html] document FILE [CAPTION]"],
  },
})

const tgApplication = buildApplication(
  tgCommandDefinition,
  {
    name: "tg",
    determineExitCode: (error) => (error instanceof Error && error.message.startsWith("tg: Usage:") ? 2 : 1),
  },
  {
    help: help({
      brief: "Print help information and exit",
      formatting: {
        caseStyle: "original",
        onlyRequiredInUsageLine: false,
        useAliasInUsageLine: false,
      },
    }),
    version: version({
      brief: "Print version information and exit",
      info: { currentVersion: "0.1.0" },
    }),
  },
)

const applicationProcess = {
  env: process.env,
  stderr: process.stderr,
  stdout: process.stdout,
  get exitCode() {
    return process.exitCode
  },
  set exitCode(value: number | string | null | undefined) {
    const numericValue = typeof value === "number" ? value : Number(value)
    if (numericValue === -4 || numericValue === -5) {
      process.exitCode = 2
      return
    }
    if (numericValue < 0) {
      process.exitCode = 1
      return
    }
    process.exitCode = value
  },
}

await run(tgApplication, process.argv.slice(2), { process: applicationProcess })
