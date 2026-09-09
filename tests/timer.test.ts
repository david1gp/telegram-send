import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { telegramTimerRun } from "../src/index.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function testDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "telegram-timer-test-"))
  temporaryDirectories.push(directory)
  return directory
}

function commandFor(script: string): readonly string[] {
  return [process.execPath, "-e", script]
}

test("streams command output, preserves failure status, and alerts with a document", async () => {
  const directory = await testDirectory()
  const output = { stdout: "", stderr: "" }
  const requests: RequestInit[] = []
  const result = await telegramTimerRun({
    command: commandFor("process.stdout.write('out\\n'); process.stderr.write('err\\n'); process.exit(7)"),
    configuration: { botToken: "token", chatId: "chat" },
    env: { HOME: directory, XDG_CONFIG_HOME: directory },
    fetch: async (_input, init) => {
      requests.push(init ?? {})
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    },
    name: "failing job",
    stderr: { write: (text) => (output.stderr += text) },
    stdout: { write: (text) => (output.stdout += text) },
  })

  expect(result.success).toBe(true)
  if (!result.success) return
  expect(result.data.exitCode).toBe(7)
  expect(output.stdout).toContain("out\n")
  expect(output.stderr).toContain("err\n")
  expect(requests).toHaveLength(1)
  const body = requests[0]?.body as FormData
  expect(body.get("disable_notification")).toBe("false")
  expect(body.get("parse_mode")).toBe("HTML")
  expect(await (body.get("document") as File).text()).toContain("=== stdout ===")
})

test("retries a failed HTML caption as plain text without changing the command status", async () => {
  const directory = await testDirectory()
  const captions: string[] = []
  const result = await telegramTimerRun({
    command: commandFor("console.log('UPDATE_APPLIED=1')"),
    configuration: { botToken: "token", chatId: "chat" },
    env: { HOME: directory, XDG_CONFIG_HOME: directory },
    fetch: async (_input, init) => {
      const body = init?.body as FormData
      captions.push(String(body.get("caption")))
      return captions.length === 1
        ? new Response(JSON.stringify({ ok: false, description: "bad HTML" }), { status: 400 })
        : new Response(JSON.stringify({ ok: true }), { status: 200 })
    },
    name: "updated job",
  })

  expect(result.success).toBe(true)
  if (!result.success) return
  expect(result.data.exitCode).toBe(0)
  expect(captions).toHaveLength(2)
  expect(captions[0]).toContain("<b>updated job</b>")
  expect(captions[1]).toContain("updated job: ok")
})

test("does not notify a successful no-op and rotates ten last-run snapshots", async () => {
  const directory = await testDirectory()
  const logDirectory = join(directory, ".config", "timers", "logs")
  let fetchCalls = 0
  for (let index = 0; index < 11; index += 1) {
    const result = await telegramTimerRun({
      command: commandFor("console.log('unchanged')"),
      configuration: { botToken: "token", chatId: "chat" },
      env: { HOME: directory },
      fetch: async () => {
        fetchCalls += 1
        return new Response(JSON.stringify({ ok: true }))
      },
      name: "no-op",
    })
    expect(result.success).toBe(true)
  }

  expect(fetchCalls).toBe(0)
  expect(await readFile(join(logDirectory, "no-op.last.log"), "utf8")).toContain("unchanged")
  expect(await Bun.file(join(logDirectory, "no-op.last.log.9")).exists()).toBe(true)
  expect(await Bun.file(join(logDirectory, "no-op.last.log.10")).exists()).toBe(false)
})

test("limits an included log file and the notification document", async () => {
  const directory = await testDirectory()
  const logFile = join(directory, "nested", "job.log")
  await mkdir(join(directory, "nested"), { recursive: true })
  await Bun.write(logFile, "0123456789abcdefghij")
  let documentText = ""
  const result = await telegramTimerRun({
    command: commandFor("console.log('UPDATE_APPLIED=1'); console.log('1234567890')"),
    configuration: { botToken: "token", chatId: "chat" },
    env: { HOME: directory },
    fetch: async (_input, init) => {
      documentText = await ((init?.body as FormData).get("document") as File).text()
      return new Response(JSON.stringify({ ok: true }))
    },
    logFile,
    maxDocumentBytes: 80,
    maxLogFileBytes: 5,
    name: "bounded",
  })

  expect(result.success).toBe(true)
  expect(new TextEncoder().encode(documentText).byteLength).toBeLessThanOrEqual(80)
  expect(documentText).toContain("fghij")
})
