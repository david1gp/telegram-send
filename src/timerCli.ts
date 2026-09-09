#!/usr/bin/env bun

import { buildApplication, buildCommand, type CommandContext, help, run, version } from "@stricli/core"
import { telegramTimerRun } from "./telegramTimerRun.js"

type TimerFlags = Readonly<{
  logFile?: string
  unit?: string
}>

type TimerContext = CommandContext

function timerUsageError(message: string): Error {
  return new Error(`tg-timer: ${message}`)
}

async function timerCommand(
  this: TimerContext,
  flags: TimerFlags,
  ...inputs: readonly string[]
): Promise<Error | undefined> {
  if (inputs.length < 2)
    return timerUsageError("Usage: tg-timer [--unit UNIT] [--log-file PATH] NAME COMMAND [ARGS...]")

  const name = inputs[0]
  const command = inputs.slice(1)
  if (!name) return timerUsageError("Usage: tg-timer [--unit UNIT] [--log-file PATH] NAME COMMAND [ARGS...]")
  const result = await telegramTimerRun({
    command,
    env: process.env,
    logFile: flags.logFile,
    name,
    stderr: this.process.stderr,
    stdout: this.process.stdout,
    unit: flags.unit,
  })
  if (!result.success) return new Error(`tg-timer: ${result.errorMessage}`)
  process.exitCode = result.data.exitCode
  return undefined
}

const timerCommandDefinition = buildCommand<TimerFlags, readonly string[], TimerContext>({
  func: timerCommand,
  parameters: {
    flags: {
      logFile: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Include a log file in the notification document",
        placeholder: "PATH",
      },
      unit: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Systemd unit name",
        placeholder: "UNIT",
      },
    },
    positional: {
      kind: "array",
      parameter: {
        brief: "Job name, command, and command arguments",
        parse: (input: string) => input,
        placeholder: "NAME COMMAND [ARGS...]",
      },
      minimum: 2,
    },
  },
  docs: {
    brief: "Run a command and notify Telegram with its captured output",
    customUsage: ["[--unit UNIT] [--log-file PATH] NAME COMMAND [ARGS...]"],
  },
})

const timerApplication = buildApplication(
  timerCommandDefinition,
  {
    name: "tg-timer",
    scanner: { allowArgumentEscapeSequence: true, caseStyle: "allow-kebab-for-camel" },
    determineExitCode: (error) => (error instanceof Error && error.message.startsWith("tg-timer: Usage:") ? 2 : 1),
  },
  {
    help: help({
      brief: "Print help information and exit",
      formatting: { caseStyle: "convert-camel-to-kebab", onlyRequiredInUsageLine: false, useAliasInUsageLine: false },
    }),
    version: version({ brief: "Print version information and exit", info: { currentVersion: "0.1.0" } }),
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

await run(timerApplication, process.argv.slice(2), { process: applicationProcess })
