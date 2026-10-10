import { spawn } from "node:child_process"
import { createWriteStream } from "node:fs"
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { homedir, hostname, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { Result } from "#result"
import { createResult, createResultError } from "#result"
import { telegramDocumentSend } from "./telegramDocumentSend.js"
import type { TelegramSendRuntimeOptions } from "./telegramSendRuntimeOptions.js"
import { telegramTimerSummaryParse } from "./telegramTimerSummaryParse.js"
import { telegramTimerSummaryRender } from "./telegramTimerSummaryRender.js"

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

function timerCaptionSelect(caption: string, header: string): string {
  if (caption.length <= 1024) return caption
  if (header.length <= 1024) return header
  return "Timer report"
}

function timerSummaryFind(
  stdout: string,
  exitCode: number,
): Readonly<{ details: readonly string[]; text: string; repositorySummary: boolean; allCountsZero: boolean }> {
  if (exitCode !== 0) return { details: [], text: "", repositorySummary: false, allCountsZero: false }
  const lines = stdout.split(/\r?\n/)
  const classifiedPackageNames = new Set<string>()
  const packageUpdates: string[] = []
  const updatedPackageNames = new Set<string>()
  for (const line of lines) {
    const update = line.match(/^\s*-\s+([^:]+):\s*(\S+)\s*->\s*(\S+),\s*(.+?)\s*$/)
    if (!update?.[1] || !update[2] || !update[3] || !update[4]) continue
    const packageName = update[1].trim()
    classifiedPackageNames.add(packageName)
    if (update[2] === update[3] || updatedPackageNames.has(packageName)) continue
    updatedPackageNames.add(packageName)
    packageUpdates.push(`- ${packageName}: ${update[2]} -> ${update[3]}, ${update[4]}`)
  }
  if (packageUpdates.length > 0) {
    const packageCount = packageUpdates.length
    return {
      details: packageUpdates,
      text: `${packageCount} package${packageCount === 1 ? "" : "s"} updated`,
      repositorySummary: false,
      allCountsZero: false,
    }
  }
  const repositorySummaryLine = lines.find((line) =>
    /^== summary:\s*created=\d+\s+updated=\d+\s+unchanged=\d+\s*$/.test(line),
  )
  if (repositorySummaryLine) {
    const counts = repositorySummaryLine.match(/created=(\d+)\s+updated=(\d+)\s+unchanged=(\d+)/)
    if (counts?.[1] && counts[2] && counts[3]) {
      const createdCount = Number(counts[1])
      const updatedCount = Number(counts[2])
      const unchangedCount = Number(counts[3])
      const categoryDetails: string[] = []
      for (const category of ["created", "updated", "unchanged"] as const) {
        const count = category === "created" ? createdCount : category === "updated" ? updatedCount : unchangedCount
        if (count === 0) continue
        const listLine = lines.find((line) => line.startsWith(`${category}:`))
        const names =
          listLine
            ?.slice(category.length + 1)
            .trim()
            .split(/\s+/)
            .filter(Boolean) ?? []
        if (category === "updated" && names.length > 0) {
          categoryDetails.push(`* ${count} updated: ${names.join(", ")}`)
          continue
        }
        if (category === "created" && names.length > 0) {
          categoryDetails.push(`* ${count} created: ${names.join(", ")}`)
          continue
        }
        categoryDetails.push(`* ${count} ${category}`)
      }
      return {
        details: categoryDetails,
        text: "",
        repositorySummary: true,
        allCountsZero: createdCount === 0 && updatedCount === 0 && unchangedCount === 0,
      }
    }
  }
  for (const line of lines) {
    const classified = line.match(/^\s*-\s+([^:]+):\s*\S+\s*->\s*\S+,\s*.+?\s*$/)
    if (classified?.[1] && classifiedPackageNames.has(classified[1].trim())) continue
    const update = line.match(/^\s*-\s+[^:]+:\s*(.* -> .*)\s*$/)
    if (update?.[1]) return { details: [], text: update[1], repositorySummary: false, allCountsZero: false }
    const state = line.match(/^\s*-\s+[^:]+:\s*((?:updated|unchanged)(?: \(.*\))?)\s*$/)
    if (state?.[1]) return { details: [], text: state[1], repositorySummary: false, allCountsZero: false }
    const summary = line.match(/^== summary:\s*(.*)$/)
    if (summary?.[1]) return { details: [], text: summary[1], repositorySummary: false, allCountsZero: false }
  }
  return { details: [], text: "", repositorySummary: false, allCountsZero: false }
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
    const structuredSummary = telegramTimerSummaryParse(stdoutText)
    const structuredReport = structuredSummary ? telegramTimerSummaryRender(structuredSummary) : undefined
    const host = env.TG_TIMER_HOST || env.HOSTNAME || hostname()
    const unit = options.unit ?? "not supplied"
    const displayCommand = timerCommandDisplay(options.command)
    const status = exitCode === 0 ? "✅" : "❌"
    const result = exitCode === 0 ? "ok" : "failed"
    const prefix = env.TG_TIMER_PREFIX ?? ""
    const htmlHeader = structuredReport
      ? `${prefix}<b>${timerHtmlEscape(options.name)}</b>: <b>${structuredReport.titleHtml}</b> in ${duration}s ${status}`
      : summary.repositorySummary
        ? `${prefix}<b>${timerHtmlEscape(options.name)}</b>: in ${duration}s ${status}`
        : summary.text
          ? `${prefix}<b>${timerHtmlEscape(options.name)}</b>: ${timerHtmlEscape(summary.text)} in ${duration}s ${status}`
          : `${prefix}<b>${timerHtmlEscape(options.name)}</b>: ${result} in ${duration}s ${status}`
    const plainHeader = structuredReport
      ? `${prefix}${options.name}: ${structuredReport.title} in ${duration}s ${status}`
      : summary.repositorySummary
        ? `${prefix}${options.name}: in ${duration}s ${status}`
        : summary.text
          ? `${prefix}${options.name}: ${summary.text} in ${duration}s ${status}`
          : `${prefix}${options.name}: ${result} in ${duration}s ${status}`
    const htmlDetails = structuredReport?.detailsHtml ?? summary.details.map((line) => timerHtmlEscape(line)).join("\n")
    const plainDetails = structuredReport?.detailsText ?? summary.details.join("\n")
    const htmlCaption = `${htmlHeader}${htmlDetails ? `\n${htmlDetails}` : ""}`
    const plainCaption = `${plainHeader}${plainDetails ? `\n${plainDetails}` : ""}`
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
    const notificationAttempted = exitCode !== 0 || (updateApplied && !summary.allCountsZero)
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
      caption: timerCaptionSelect(htmlCaption, htmlHeader),
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
      caption: timerCaptionSelect(plainCaption, plainHeader),
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
