import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { tgCommand } from "../src/tgCommand.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

test.serial("getUpdates prints JSON and forwards polling options without a chat ID", async () => {
  const directory = await mkdtemp(join(tmpdir(), "telegram-send-cli-test-"))
  temporaryDirectories.push(directory)
  const envFile = join(directory, "telegram.env")
  await Bun.write(envFile, "TELEGRAM_BOT_TOKEN=token\n")

  const previousEnvFile = process.env.TG_ENV_FILE
  const previousFetch = globalThis.fetch
  let output = ""
  let request: RequestInit | undefined
  process.env.TG_ENV_FILE = envFile
  globalThis.fetch = (async (_input, init) => {
    request = init
    return new Response(JSON.stringify({ ok: true, result: [{ update_id: 12 }] }), { status: 200 })
  }) as typeof fetch

  try {
    const error = await tgCommand.call(
      { process: { stderr: { write: () => {} }, stdout: { write: (value) => (output += value) } } },
      { alert: false, html: false, limit: 10, offset: 7, timeout: 5 },
      "getUpdates",
    )

    expect(error).toBeUndefined()
    expect(output).toBe('[{"update_id":12}]\n')
    expect(new URLSearchParams(request?.body as string).toString()).toBe("offset=7&limit=10&timeout=5")
  } finally {
    globalThis.fetch = previousFetch
    if (previousEnvFile === undefined) delete process.env.TG_ENV_FILE
    else process.env.TG_ENV_FILE = previousEnvFile
  }
})

test.serial("getChatId prints unique IDs newest first, one per line", async () => {
  const directory = await mkdtemp(join(tmpdir(), "telegram-send-cli-test-"))
  temporaryDirectories.push(directory)
  const envFile = join(directory, "telegram.env")
  await Bun.write(envFile, "TELEGRAM_BOT_TOKEN=token\n")

  const previousEnvFile = process.env.TG_ENV_FILE
  const previousFetch = globalThis.fetch
  let output = ""
  process.env.TG_ENV_FILE = envFile
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        ok: true,
        result: [
          { update_id: 2, message: { chat: { id: 100 } } },
          { update_id: 9, message: { chat: { id: 300 } } },
          { update_id: 5, message: { chat: { id: 100 } } },
        ],
      }),
      { status: 200 },
    )) as unknown as typeof fetch

  try {
    const error = await tgCommand.call(
      { process: { stderr: { write: () => {} }, stdout: { write: (value) => (output += value) } } },
      { alert: false, html: false },
      "getChatId",
    )

    expect(error).toBeUndefined()
    expect(output).toBe("300\n100\n")
  } finally {
    globalThis.fetch = previousFetch
    if (previousEnvFile === undefined) delete process.env.TG_ENV_FILE
    else process.env.TG_ENV_FILE = previousEnvFile
  }
})
