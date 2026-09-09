import * as v from "valibot"

const telegramConfigurationSchema = v.object({
  botToken: v.pipe(v.string(), v.trim(), v.minLength(1)),
  chatId: v.pipe(v.string(), v.trim(), v.minLength(1)),
})

type TelegramConfiguration = v.InferOutput<typeof telegramConfigurationSchema>

export type { TelegramConfiguration }
export { telegramConfigurationSchema }
