import type { Result } from "#result"
import { createResult, createResultError } from "#result"
import {
  type TelegramChatId,
  type TelegramUpdate,
  type TelegramUpdatesGetOptions,
  telegramUpdatesGet,
} from "./telegramUpdatesGet.js"

type TelegramChatIdGetOptions = TelegramUpdatesGetOptions

function telegramUpdateChatIdFind(update: TelegramUpdate): TelegramChatId | undefined {
  const candidates = [
    update.message,
    update.edited_message,
    update.channel_post,
    update.edited_channel_post,
    update.my_chat_member,
    update.chat_member,
    typeof update.callback_query === "object" && update.callback_query !== null
      ? update.callback_query.message
      : undefined,
    ...Object.values(update),
  ]
  for (const candidate of candidates) {
    if (typeof candidate !== "object" || candidate === null || !("chat" in candidate)) continue
    const chat = candidate.chat
    if (typeof chat !== "object" || chat === null || !("id" in chat)) continue
    if (typeof chat.id === "number" && Number.isInteger(chat.id)) return chat.id
    if (typeof chat.id === "string" && chat.id.length > 0) return chat.id
  }
  return undefined
}

async function telegramChatIdGet(options: TelegramChatIdGetOptions = {}): Promise<Result<readonly TelegramChatId[]>> {
  const op = "telegramChatIdGet"
  const updates = await telegramUpdatesGet(options)
  if (!updates.success) return createResultError(op, updates.errorMessage)

  const orderedUpdates = [...updates.data].sort((left, right) => right.update_id - left.update_id)
  const chatIds = new Map<string, TelegramChatId>()
  for (const update of orderedUpdates) {
    const chatId = telegramUpdateChatIdFind(update)
    if (chatId === undefined) continue
    const key = String(chatId)
    if (!chatIds.has(key)) chatIds.set(key, chatId)
  }
  return createResult([...chatIds.values()])
}

export type { TelegramChatIdGetOptions }
export { telegramChatIdGet }
