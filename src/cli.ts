#!/usr/bin/env bun

import { buildApplication, buildCommand, type CommandContext, help, numberParser, run, version } from "@stricli/core"
import { packageVersion } from "./packageVersion.js"
import { telegramSendVersionMetadataRender } from "./telegramSendVersionMetadataRender.js"
import { tgCommand } from "./tgCommand.js"

type TgFlags = Readonly<{
  alert: boolean
  html: boolean
  limit?: number
  offset?: number
  timeout?: number
}>

type TgContext = CommandContext

const tgCommandDefinition = buildCommand<TgFlags, readonly string[], TgContext>({
  func: tgCommand,
  parameters: {
    flags: {
      alert: { kind: "boolean", brief: "Send with notifications enabled", withNegated: false },
      html: { kind: "boolean", brief: "Parse message or caption as HTML", withNegated: false },
      limit: {
        kind: "parsed",
        parse: numberParser,
        optional: true,
        brief: "Maximum number of updates (1-100)",
        placeholder: "COUNT",
      },
      offset: {
        kind: "parsed",
        parse: numberParser,
        optional: true,
        brief: "Identifier of the first update to return",
        placeholder: "ID",
      },
      timeout: {
        kind: "parsed",
        parse: numberParser,
        optional: true,
        brief: "Long-poll timeout in seconds (0-50)",
        placeholder: "SECONDS",
      },
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
    brief: "Send messages/documents or inspect Telegram updates",
    customUsage: [
      "[--alert] [--html] MESSAGE",
      "[--alert] [--html] document FILE [CAPTION]",
      "[--offset ID] [--limit COUNT] [--timeout SECONDS] getUpdates",
      "[--offset ID] [--limit COUNT] [--timeout SECONDS] getChatId",
    ],
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
      info: { currentVersion: packageVersion },
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

const args = process.argv.slice(2)
const verboseVersion = args.includes("--verbose") && (args.includes("--version") || args[0] === "version")

if (verboseVersion) {
  process.stdout.write(telegramSendVersionMetadataRender("tg"))
} else {
  await run(tgApplication, args, { process: applicationProcess })
}
