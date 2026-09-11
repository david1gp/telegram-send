import * as v from "valibot"

const telegramBotConfigurationSchema = v.object({
  botToken: v.pipe(v.string(), v.trim(), v.minLength(1)),
})

type TelegramBotConfiguration = v.InferOutput<typeof telegramBotConfigurationSchema>

export type { TelegramBotConfiguration }
export { telegramBotConfigurationSchema }
