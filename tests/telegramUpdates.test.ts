import { expect, test } from "bun:test"
import { telegramChatIdGet, telegramUpdatesGet } from "../src/index.js"

test("gets updates with token-only configuration and API options", async () => {
  let request: { input: string | URL; init?: RequestInit } | undefined
  const result = await telegramUpdatesGet({
    configuration: { botToken: "token" },
    fetch: async (input, init) => {
      request = { input, init }
      return new Response(JSON.stringify({ ok: true, result: [{ update_id: 12 }] }), { status: 200 })
    },
    limit: 10,
    offset: 7,
    timeout: 5,
  })

  expect(result).toEqual({ success: true, data: [{ update_id: 12 }] })
  expect(request?.input.toString()).toBe("https://api.telegram.org/bottoken/getUpdates")
  expect(request?.init?.method).toBe("POST")
  expect(new URLSearchParams(request?.init?.body as string).toString()).toBe("offset=7&limit=10&timeout=5")
})

test("gets unique chat IDs ordered by update recency across chat-bearing updates", async () => {
  const result = await telegramChatIdGet({
    configuration: { botToken: "token" },
    fetch: async () =>
      new Response(
        JSON.stringify({
          ok: true,
          result: [
            { update_id: 2, message: { chat: { id: 100 } } },
            { update_id: 5, edited_message: { chat: { id: 200 } } },
            { update_id: 4, channel_post: { chat: { id: 100 } } },
            { update_id: 9, my_chat_member: { chat: { id: 300 } } },
            { update_id: 8, chat_member: { chat: { id: 400 } } },
            { update_id: 7, callback_query: { message: { chat: { id: 500 } } } },
            { update_id: 1, edited_channel_post: { chat: { id: 600 } } },
            { update_id: 6, chat_join_request: { chat: { id: 700 } } },
            { update_id: 3, callback_query: {} },
          ],
        }),
        { status: 200 },
      ),
  })

  expect(result).toEqual({ success: true, data: [300, 400, 500, 700, 200, 100, 600] })
})

test("does not add an implicit update offset", async () => {
  let request: RequestInit | undefined
  const result = await telegramChatIdGet({
    configuration: { botToken: "token" },
    fetch: async (_input, init) => {
      request = init
      return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 })
    },
  })

  expect(result).toEqual({ success: true, data: [] })
  expect(new URLSearchParams(request?.body as string).toString()).toBe("")
})

test("rejects update options outside the Telegram API limits", async () => {
  let requests = 0
  const fetch = async () => {
    requests += 1
    return new Response(JSON.stringify({ ok: true, result: [] }))
  }

  const limitResult = await telegramUpdatesGet({ configuration: { botToken: "token" }, fetch, limit: 101 })
  const timeoutResult = await telegramUpdatesGet({ configuration: { botToken: "token" }, fetch, timeout: -1 })

  expect(limitResult).toEqual({
    success: false,
    op: "telegramUpdatesGet",
    errorMessage: "limit must be an integer between 1 and 100",
  })
  expect(timeoutResult).toEqual({
    success: false,
    op: "telegramUpdatesGet",
    errorMessage: "timeout must be an integer between 0 and 50",
  })
  expect(requests).toBe(0)
})
