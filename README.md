# @adaptive-ds/telegram-send

Small, Result-based Telegram notifications for Bun: use `tg` for one-off messages and documents, or `tg-timer` to wrap scheduled jobs with useful summaries and logs.

## Requirements

- [Bun](https://bun.sh/) `>= 1.3.0` for the CLIs
- Node.js `>= 22` is also declared for library consumers

## Installation

Install the library in a project:

```sh
bun add @adaptive-ds/telegram-send @adaptive-ds/result valibot
```

Install the commands globally:

```sh
bun add --global @adaptive-ds/telegram-send @adaptive-ds/result valibot
```

Both commands also support `--help` and `--version`.

## Configuration

By default, credentials are read from `~/.config/timers/telegram.env`:

```dotenv
TELEGRAM_BOT_TOKEN=123456:replace-me
TELEGRAM_CHAT_ID=-1001234567890
```

The file may contain comments, `export` prefixes, and quoted values. Keep it private (for example, `chmod 600 ~/.config/timers/telegram.env`). File values take precedence over same-named process environment variables.

Use `TG_ENV_FILE=/path/to/telegram.env` to select another file for the CLIs. Library calls can pass `envFile` instead. Unless a library call supplies `configuration` directly, the selected file must be readable; `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` may then fall back to the supplied environment.

## `tg`

Send a silent message by default:

```sh
tg "Deployment completed"
tg --alert "Deployment failed"
tg --html --alert '<b>Deployment completed</b>'
```

Send a document with an optional caption:

```sh
tg --alert document ./build.log "Build output"
```

`sendDocument` is accepted as an alias for `document`. `--alert` enables Telegram notifications; without it, messages and documents are sent silently. `--html` sets Telegram's `parse_mode` to `HTML`.

Inspect pending updates with a bot token only:

```sh
tg getUpdates
tg getUpdates --offset 123 --limit 20 --timeout 10
tg getChatId --limit 100
```

`getUpdates` prints the JSON update array. `getChatId` prints unique chat IDs one per line, ordered by the newest update first, which makes its output convenient for shell use. These commands do not acknowledge or advance updates implicitly; use Telegram's `offset` deliberately when polling.

## `tg-timer`

Wrap a scheduled command:

```sh
tg-timer --unit backup.service --log-file /var/log/backup.log backup bun run backup
```

Child stdout and stderr are streamed through and uploaded with the notification. The child exit code is preserved. A notification is sent when the command fails, or when a successful command prints the exact line `UPDATE_APPLIED=1` to stdout. Successful commands without that marker do not contact Telegram.

Successful update notifications are silent; failure notifications are alerting. Captions include the job, host, unit, command, duration, and exit code. `tg-timer` tries an HTML caption first and retries with plain text if Telegram rejects it.

### Summary and update conventions

For a successful command, the first matching summary line becomes the notification headline:

```text
- settings: old value -> new value
- cache: updated (3 files)
== summary: 2 changes
```

To force a notification for a successful run, print `UPDATE_APPLIED=1` on its own line (with no indentation). A failed command always notifies, regardless of its output.

### Logs

Every run is saved at:

```text
${XDG_CONFIG_HOME:-$HOME/.config}/timers/logs/NAME.last.log
```

The current log includes run metadata followed by `=== stdout ===` and `=== stderr ===` sections, plus an optional `=== log-file PATH ===` section. Nine rotated snapshots (`.1` through `.9`) are retained. Included log files are limited to 200 KB by default, and notification documents to 45 MB. Set `TG_TIMER_DEBUG=1` for capture, summary, and upload diagnostics on stderr. `TG_TIMER_PREFIX` and `TG_TIMER_HOST` customize the notification prefix and host label.

## Library

The package exports:

- `telegramMessageSend` (`telegramSendMessage` alias)
- `telegramDocumentSend` (`telegramSendDocument` alias)
- `telegramUpdatesGet`
- `telegramChatIdGet`
- `telegramTimerRun`
- `telegramConfigurationLoad` and `telegramConfigurationSchema`
- `TelegramConfiguration`, `TelegramConfigurationLoadOptions`, `TelegramDocumentSendOptions`,
  `TelegramMessageSendOptions`, `TelegramUpdatesGetOptions`, `TelegramChatIdGetOptions`,
  `TelegramUpdate`, `TelegramChatId`, `TelegramSendRuntimeOptions`, `TelegramTimerRunOptions`, and
  `TelegramTimerRunResult` (plus `TelegramEnvironment`, `TelegramFetch`, and `TelegramTimerOutput`)

The async configuration, sending, and timer operations return a `Promise<Result<T>>` from `@adaptive-ds/result` rather than throwing expected configuration, file, network, or Telegram API failures:

```ts
import { telegramMessageSend } from "@adaptive-ds/telegram-send"

const result = await telegramMessageSend({
  alert: true,
  message: "Deployment completed",
})

if (!result.success) {
  console.error(`${result.op}: ${result.errorMessage}`)
  process.exitCode = 1
} else {
  console.log("Telegram accepted the message")
}
```

Pass `configuration`, `env`, `envFile`, `fetch`, or `signal` through the runtime options when embedding the library. `telegramTimerRun` additionally accepts the command, job name, optional systemd unit, log file, output writers, and document-size limits.

`telegramUpdatesGet()` requires only `botToken` and supports `offset`, `limit`, and long-poll `timeout` options. `telegramChatIdGet()` uses the same options, sorts returned updates newest first, keeps the first occurrence of each chat ID, and returns the resulting IDs without acknowledging any update:

```ts
import { telegramChatIdGet, telegramUpdatesGet } from "@adaptive-ds/telegram-send"

const updates = await telegramUpdatesGet({ configuration: { botToken: "123456:replace-me" }, limit: 20 })
const chatIds = await telegramChatIdGet({ configuration: { botToken: "123456:replace-me" } })
```

## Failure behavior

- Missing CLI arguments print usage and exit with code `2`.
- Configuration, unreadable files, network errors, and Telegram API errors are reported as `tg: ...` or `tg-timer: ...` and exit with code `1`.
- `tg-timer` preserves the wrapped command's exit code.
- If both Telegram upload attempts fail, `telegramTimerRun` returns `notified: false` but does not replace the wrapped command's exit code.

## Development scripts

```sh
bun run format          # format source and configuration
bun run format:check
bun run type-check
bun run test
bun run build
bun run deploy          # format check, type check, tests, and build
```

`bun run release [VERSION]` prepares a changelog, updates the package version, builds, and creates the corresponding GitHub release; it requires authenticated `gh` and a Git checkout.

## License

[MIT](./LICENSE) © 2026 David Siewert
