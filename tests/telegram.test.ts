import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { telegramConfigurationLoad, telegramDocumentSend, telegramMessageSend } from "../src/index.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

test("sends a silent HTML message", async () => {
  let request: { input: string | URL; init?: RequestInit } | undefined
  const result = await telegramMessageSend({
    configuration: { botToken: "token", chatId: "chat" },
    fetch: async (input, init) => {
      request = { input, init }
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 })
    },
    html: true,
    message: "<b>Hello</b>",
  })

  expect(result.success).toBe(true)
  expect(request?.input.toString()).toBe("https://api.telegram.org/bottoken/sendMessage")
  const body = new URLSearchParams(request?.init?.body as string)
  expect(body.get("chat_id")).toBe("chat")
  expect(body.get("text")).toBe("<b>Hello</b>")
  expect(body.get("parse_mode")).toBe("HTML")
  expect(body.get("disable_notification")).toBe("true")
  expect(body.get("disable_web_page_preview")).toBe("true")
})

test("sends an alerting document with a plain caption", async () => {
  const directory = await mkdtemp(join(tmpdir(), "telegram-send-test-"))
  temporaryDirectories.push(directory)
  const file = join(directory, "output.txt")
  await Bun.write(file, "document contents")
  let request: RequestInit | undefined

  const result = await telegramDocumentSend({
    alert: true,
    caption: "caption",
    configuration: { botToken: "token", chatId: "chat" },
    fetch: async (_input, init) => {
      request = init
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    },
    file,
  })

  expect(result.success).toBe(true)
  const body = request?.body as FormData
  expect(body.get("chat_id")).toBe("chat")
  expect(body.get("caption")).toBe("caption")
  expect(body.get("disable_notification")).toBe("false")
  expect(body.get("document")).toBeInstanceOf(File)
  expect(await (body.get("document") as File).text()).toBe("document contents")
})

test("file values override the environment and default values remain available", async () => {
  const directory = await mkdtemp(join(tmpdir(), "telegram-send-test-"))
  temporaryDirectories.push(directory)
  const envFile = join(directory, "override.env")
  const defaultDirectory = join(directory, ".config", "timers")
  await mkdir(defaultDirectory, { recursive: true })
  await Bun.write(
    join(defaultDirectory, "telegram.env"),
    "TELEGRAM_BOT_TOKEN=from-default\nTELEGRAM_CHAT_ID=default-chat\n",
  )
  await Bun.write(envFile, "TELEGRAM_BOT_TOKEN=from-file\nTELEGRAM_CHAT_ID=file-chat\n")

  const defaultResult = await telegramConfigurationLoad({
    env: {
      HOME: directory,
      TELEGRAM_BOT_TOKEN: "from-environment",
      TELEGRAM_CHAT_ID: "environment-chat",
    },
  })
  const overrideResult = await telegramConfigurationLoad({
    env: { HOME: directory },
    envFile,
  })

  expect(defaultResult).toEqual({ success: true, data: { botToken: "from-default", chatId: "default-chat" } })
  expect(overrideResult).toEqual({ success: true, data: { botToken: "from-file", chatId: "file-chat" } })
})

test("returns Telegram API failures as Result errors", async () => {
  const result = await telegramMessageSend({
    configuration: { botToken: "token", chatId: "chat" },
    fetch: async () => new Response(JSON.stringify({ ok: false, description: "bad request" }), { status: 400 }),
    message: "message",
  })

  expect(result).toEqual({
    success: false,
    op: "telegramMessageSend",
    errorMessage: "sendMessage failed: bad request",
  })
})
