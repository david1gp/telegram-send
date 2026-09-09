import { spawn } from "node:child_process"
import { createWriteStream } from "node:fs"
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { homedir, hostname, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { Result } from "#result"
import { createResult, createResultError } from "#result"
import { telegramDocumentSend } from "./telegramDocumentSend.js"
import type { TelegramSendRuntimeOptions } from "./telegramSendRuntimeOptions.js"

const defaultMaxLogFileBytes = 200_000
const defaultMaxDocumentBytes = 45 * 1024 * 1024
const maxSnapshots = 10

type TelegramTimerOutput = Readonly<{
  write: (text: string) => void
}>

type TelegramTimerRunOptions = TelegramSendRuntimeOptions &
  Readonly<{
    command: readonly string[]
    logFile?: string
    maxDocumentBytes?: number
    maxLogFileBytes?: number
    name: string
    now?: () => Date
    stderr?: TelegramTimerOutput
    stdout?: TelegramTimerOutput
    unit?: string
  }>

type TelegramTimerRunResult = Readonly<{
  exitCode: number
  lastLogFile: string
  notificationAttempted: boolean
  notified: boolean
}>

type TimerCapture = Readonly<{
  file: string
  finish: () => Promise<void>
  write: (chunk: Uint8Array) => void
}>

function timerOutputResolve(
  output: TelegramTimerOutput | undefined,
  fallback: NodeJS.WriteStream,
): TelegramTimerOutput {
  return output ?? fallback
}

function timerCommandQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value
  return `'${value.replaceAll("'", "'\\''")}'`
}

function timerCommandDisplay(command: readonly string[]): string {
  return command.map(timerCommandQuote).join(" ")
}

function timerHtmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

function timerSafeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "_")
}

function timerSummaryFind(stdout: string, exitCode: number): string {
  if (exitCode !== 0) return ""
  for (const line of stdout.split(/\r?\n/)) {
    const update = line.match(/^\s*-\s+[^:]+:\s*(.* -> .*)\s*$/)
    if (update?.[1]) return update[1]
    const state = line.match(/^\s*-\s+[^:]+:\s*((?:updated|unchanged)(?: \(.*\))?)\s*$/)
    if (state?.[1]) return state[1]
    const summary = line.match(/^== summary:\s*(.*)$/)
    if (summary?.[1]) return summary[1]
  }
  return ""
}

function timerDateFormat(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0")
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? "+" : "-"
  const hours = pad(Math.floor(Math.abs(offset) / 60))
  const minutes = pad(Math.abs(offset) % 60)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${sign}${hours}${minutes}`
}

function timerCaptureCreate(file: string): TimerCapture {
  const stream = createWriteStream(file)
  let finished: Promise<void> | undefined
  return {
    file,
    finish: () => {
      finished ??= new Promise<void>((resolve, reject) => {
        stream.once("finish", resolve)
        stream.once("error", reject)
      })
      stream.end()
      return finished
    },
    write: (chunk) => {
      stream.write(chunk)
    },
  }
}

async function timerCommandRun(
  command: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  stdoutCapture: TimerCapture,
  stderrCapture: TimerCapture,
  stdout: TelegramTimerOutput,
  stderr: TelegramTimerOutput,
): Promise<number> {
  const [executable, ...arguments_] = command
  if (!executable) return 2

  const child = spawn(executable, arguments_, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  })
  const stdoutDecoder = new TextDecoder()
  const stderrDecoder = new TextDecoder()
  child.stdout.on("data", (chunk: Uint8Array) => {
    stdoutCapture.write(chunk)
    stdout.write(stdoutDecoder.decode(chunk, { stream: true }))
  })
  child.stderr.on("data", (chunk: Uint8Array) => {
    stderrCapture.write(chunk)
    stderr.write(stderrDecoder.decode(chunk, { stream: true }))
  })

  const result = await new Promise<Readonly<{ code: number; error?: string }>>((resolve) => {
    child.once("error", (error: Error) => resolve({ code: 127, error: error.message }))
    child.once("close", (code, signal) => {
      if (code !== null) {
        resolve({ code })
        return
      }
      resolve({ code: signal ? 128 : 1 })
    })
  })
  const finalStdout = stdoutDecoder.decode()
  if (finalStdout) stdout.write(finalStdout)
  const finalStderr = stderrDecoder.decode()
  if (finalStderr) stderr.write(finalStderr)
  if (result.error) stderr.write(`${result.error}\n`)
  await Promise.all([stdoutCapture.finish(), stderrCapture.finish()])
  return result.code
}

async function timerFileReadBounded(
  file: string,
  maxBytes: number,
): Promise<Readonly<{ contents: Buffer; readable: boolean; truncated: boolean }>> {
  try {
    const contents = await readFile(file)
    if (contents.byteLength <= maxBytes) return { contents, readable: true, truncated: false }
    return { contents: contents.subarray(contents.byteLength - maxBytes), readable: true, truncated: true }
  } catch {
    return { contents: Buffer.alloc(0), readable: false, truncated: false }
  }
}

async function timerSnapshotsRotate(lastLogFile: string): Promise<void> {
  for (let index = maxSnapshots - 1; index >= 1; index -= 1) {
    const source = index === 1 ? lastLogFile : `${lastLogFile}.${index - 1}`
    const destination = `${lastLogFile}.${index}`
    try {
      await rename(source, destination)
    } catch {
      // A missing snapshot is expected on the first few invocations.
    }
  }
}

async function telegramTimerRun(options: TelegramTimerRunOptions): Promise<Result<TelegramTimerRunResult>> {
  const op = "telegramTimerRun"
  if (options.command.length === 0) return createResultError(op, "a command is required")

  const env = { ...(options.env ?? process.env) }
  const home = env.HOME ?? homedir()
  env.PATH = `${home}/.local/bin:/usr/local/bin:/usr/bin:/bin:${env.PATH ?? ""}`
  const stdout = timerOutputResolve(options.stdout, process.stdout)
  const stderr = timerOutputResolve(options.stderr, process.stderr)
  const started = (options.now ?? (() => new Date()))()
  let workDirectory: string | undefined
  let lastLogFile = ""
  let exitCode = 1

  try {
    if (options.logFile) await mkdir(dirname(options.logFile), { recursive: true })
    workDirectory = await mkdtemp(join(tmpdir(), "tg-timer-"))
    const stdoutCapture = timerCaptureCreate(join(workDirectory, "stdout"))
    const stderrCapture = timerCaptureCreate(join(workDirectory, "stderr"))
    exitCode = await timerCommandRun(options.command, env, stdoutCapture, stderrCapture, stdout, stderr)
    const ended = (options.now ?? (() => new Date()))()
    const duration = Math.max(0, Math.floor((ended.getTime() - started.getTime()) / 1000))
    const stdoutContents = await readFile(stdoutCapture.file)
    const stderrContents = await readFile(stderrCapture.file)
    const stdoutText = stdoutContents.toString()
    const summary = timerSummaryFind(stdoutText, exitCode)
    const host = env.TG_TIMER_HOST || env.HOSTNAME || hostname()
    const unit = options.unit ?? "not supplied"
    const displayCommand = timerCommandDisplay(options.command)
    const status = exitCode === 0 ? "✅" : "❌"
    const result = exitCode === 0 ? "ok" : "failed"
    const prefix = env.TG_TIMER_PREFIX ?? ""
    const htmlHeader = summary
      ? `${prefix}<b>${timerHtmlEscape(options.name)}</b>: ${timerHtmlEscape(summary)} in ${duration}s ${status}`
      : `${prefix}<b>${timerHtmlEscape(options.name)}</b>: ${result} in ${duration}s ${status}`
    const plainHeader = summary
      ? `${prefix}${options.name}: ${summary} in ${duration}s ${status}`
      : `${prefix}${options.name}: ${result} in ${duration}s ${status}`
    const cardLines = [
      `job: ${timerHtmlEscape(options.name)}`,
      `host: ${timerHtmlEscape(host)}`,
      `unit: ${timerHtmlEscape(unit)}`,
      `command: ${timerHtmlEscape(displayCommand)}`,
      `duration: ${duration}s`,
      `exit: ${exitCode}`,
    ]
    const plainLines = [
      `job: ${options.name}`,
      `host: ${host}`,
      `unit: ${unit}`,
      `command: ${displayCommand}`,
      `duration: ${duration}s`,
      `exit: ${exitCode}`,
    ]
    if (options.logFile) {
      cardLines.push(`log: ${timerHtmlEscape(options.logFile)}`)
      plainLines.push(`log: ${options.logFile}`)
    }
    const htmlCaption = `${htmlHeader}\n<pre>${cardLines.join("\n")}</pre>`
    const plainCaption = `${plainHeader}\n${plainLines.join("\n")}`
    const documentParts = [
      Buffer.from("=== stdout ===\n"),
      stdoutContents,
      Buffer.from("\n=== stderr ===\n"),
      stderrContents,
    ]
    if (options.logFile) {
      const log = await timerFileReadBounded(options.logFile, options.maxLogFileBytes ?? defaultMaxLogFileBytes)
      documentParts.push(Buffer.from(`\n=== log-file ${options.logFile} ===\n`))
      if (!log.readable) {
        documentParts.push(Buffer.from("(not readable)\n"))
      } else {
        if (log.truncated) documentParts.push(Buffer.from("(log file exceeds 200KB - showing last 200KB)\n"))
        documentParts.push(Buffer.from(log.contents))
      }
    }
    const document = Buffer.concat(documentParts)
    const maxDocumentBytes = options.maxDocumentBytes ?? defaultMaxDocumentBytes
    const safeName = timerSafeName(options.name)
    const documentFile = join(workDirectory, `${safeName}-logs.txt`)
    if (document.byteLength > maxDocumentBytes) {
      const notice = Buffer.from(`(document exceeded ${maxDocumentBytes} bytes - showing the last bytes)\n\n`)
      const availableNotice = notice.subarray(0, maxDocumentBytes)
      const tailLength = Math.max(0, maxDocumentBytes - availableNotice.byteLength)
      await writeFile(
        documentFile,
        Buffer.concat([availableNotice, document.subarray(document.byteLength - tailLength)]),
      )
    } else {
      await writeFile(documentFile, document)
    }

    const lastLogDirectory = join(env.XDG_CONFIG_HOME || join(home, ".config"), "timers", "logs")
    await mkdir(lastLogDirectory, { recursive: true })
    lastLogFile = join(lastLogDirectory, `${safeName}.last.log`)
    await timerSnapshotsRotate(lastLogFile)
    const logHeader = [
      `job: ${options.name}`,
      `host: ${host}`,
      `unit: ${unit}`,
      `command: ${displayCommand}`,
      `started: ${timerDateFormat(started)}`,
      `duration: ${duration}s`,
      `exit: ${exitCode}`,
      ...(options.logFile ? [`log-file: ${options.logFile}`] : []),
      "",
    ].join("\n")
    await writeFile(lastLogFile, Buffer.concat([Buffer.from(logHeader), await readFile(documentFile)]))
    stderr.write(`tg-timer: last run log: ${lastLogFile}\n`)

    if (env.TG_TIMER_DEBUG === "1") {
      stderr.write(
        `tg-timer: captured stdout=${stdoutContents.byteLength} bytes stderr=${stderrContents.byteLength} bytes\n`,
      )
      stderr.write(`tg-timer: summary:\n${plainCaption}\n`)
    }
    const updateApplied = stdoutText.split(/\r?\n/).some((line) => line === "UPDATE_APPLIED=1")
    const notificationAttempted = exitCode !== 0 || updateApplied
    if (!notificationAttempted) {
      if (env.TG_TIMER_DEBUG === "1") stderr.write("tg-timer: skipping Telegram (success without UPDATE_APPLIED=1)\n")
      return createResult({ exitCode, lastLogFile, notificationAttempted, notified: false })
    }

    if (env.TG_TIMER_DEBUG === "1") {
      stderr.write(`tg-timer: document=${safeName}-logs.txt bytes=${(await stat(documentFile)).size}\n`)
    }
    const alert = exitCode !== 0
    const htmlResult = await telegramDocumentSend({
      alert,
      caption: htmlCaption.length > 1024 ? htmlHeader : htmlCaption,
      configuration: options.configuration,
      env: options.env,
      envFile: options.envFile,
      fetch: options.fetch,
      file: documentFile,
      html: true,
      signal: options.signal,
    })
    if (htmlResult.success) {
      stderr.write("tg-timer: Telegram document uploaded\n")
      return createResult({ exitCode, lastLogFile, notificationAttempted, notified: true })
    }
    stderr.write("tg-timer: HTML document caption failed; retrying as plain text\n")
    const plainResult = await telegramDocumentSend({
      alert,
      caption: plainCaption.length > 1024 ? plainHeader : plainCaption,
      configuration: options.configuration,
      env: options.env,
      envFile: options.envFile,
      fetch: options.fetch,
      file: documentFile,
      signal: options.signal,
    })
    if (plainResult.success) {
      stderr.write("tg-timer: Telegram document uploaded (plain caption)\n")
      return createResult({ exitCode, lastLogFile, notificationAttempted, notified: true })
    }
    stderr.write("tg-timer: Telegram document upload failed entirely\n")
    return createResult({ exitCode, lastLogFile, notificationAttempted, notified: false })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return createResultError(op, message)
  } finally {
    if (workDirectory) await rm(workDirectory, { recursive: true, force: true }).catch(() => undefined)
  }
}

export type { TelegramTimerOutput, TelegramTimerRunOptions, TelegramTimerRunResult }
export { telegramTimerRun }
