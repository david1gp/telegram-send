import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { telegramTimerRun, telegramTimerSummaryParse, telegramTimerSummaryRender } from "../src/index.js"

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

test("ignores malformed structured metadata and unsafe URLs without throwing", () => {
  expect(telegramTimerSummaryParse("UPDATE_SUMMARY={bad json}")).toBeUndefined()
  expect(
    telegramTimerSummaryParse('UPDATE_SUMMARY={"items":[{"name":"only batch item","to":"1"}]}')?.items,
  ).toHaveLength(1)
  const summary = telegramTimerSummaryParse(
    'UPDATE_SUMMARY={"name":"<release>","releaseUrl":"file:///etc/passwd","items":[null,{"name":"pkg","to":"2","releaseUrl":"https://example.com/r"}]}',
  )
  expect(summary).toBeDefined()
  if (!summary) return
  const rendered = telegramTimerSummaryRender(summary)
  expect(rendered.title).toBe("<release>")
  expect(rendered.titleHtml).toBe("&lt;release&gt;")
  expect(rendered.detailsHtml).not.toContain("file:")
  expect(rendered.detailsHtml).toContain('href="https://example.com/r"')
})

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

test("summarizes changed packages with their names and classifications in HTML and plain captions", async () => {
  const directory = await testDirectory()
  const captions: string[] = []
  const times = [new Date(0), new Date(8_000)]
  const result = await telegramTimerRun({
    command: commandFor(
      [
        "console.log('- vite: 8.3.2 -> 8.3.3, patch')",
        "console.log('- esbuild: 0.25.0 -> 0.25.1, minor')",
        "console.log('- bun: 1.4.2 -> 1.4.2, unchanged')",
        "console.log('UPDATE_APPLIED=1')",
      ].join("; "),
    ),
    configuration: { botToken: "token", chatId: "chat" },
    env: { HOME: directory, XDG_CONFIG_HOME: directory },
    fetch: async (_input, init) => {
      const body = init?.body as FormData
      captions.push(String(body.get("caption")))
      return captions.length === 1
        ? new Response(JSON.stringify({ ok: false, description: "bad HTML" }), { status: 400 })
        : new Response(JSON.stringify({ ok: true }), { status: 200 })
    },
    name: "bun_update_global",
    now: () => times.shift() ?? new Date(8_000),
  })

  expect(result.success).toBe(true)
  if (!result.success) return
  expect(result.data.exitCode).toBe(0)
  expect(captions).toHaveLength(2)
  expect(captions[0]).toContain("<b>bun_update_global</b>: 2 packages updated in 8s ✅")
  expect(captions[0]).toContain("- vite: 8.3.2 -&gt; 8.3.3, patch")
  expect(captions[0]).toContain("- esbuild: 0.25.0 -&gt; 0.25.1, minor")
  expect(captions[0]).not.toContain("- bun:")
  expect(captions[1]).toContain("bun_update_global: 2 packages updated in 8s ✅")
  expect(captions[1]).toContain("- vite: 8.3.2 -> 8.3.3, patch")
  expect(captions[1]).toContain("- esbuild: 0.25.0 -> 0.25.1, minor")
  expect(captions[1]).not.toContain("- bun:")
  expect(captions[0]).toContain("<b>bun_update_global</b>")
  expect(captions[1]).not.toContain("<b>")
})

test("formats repository update counts as categorized details without counts in the heading", async () => {
  const directory = await testDirectory()
  const captions: string[] = []
  const times = [new Date(0), new Date(125_000)]
  const result = await telegramTimerRun({
    command: commandFor(
      [
        "console.log('== summary: created=0 updated=5 unchanged=23')",
        "console.log('updated: x y z')",
        "console.log('unchanged: a b')",
        "console.log('UPDATE_APPLIED=1')",
      ].join("; "),
    ),
    configuration: { botToken: "token", chatId: "chat" },
    env: { HOME: directory, XDG_CONFIG_HOME: directory },
    fetch: async (_input, init) => {
      captions.push(String((init?.body as FormData).get("caption")))
      return captions.length === 1
        ? new Response(JSON.stringify({ ok: false, description: "bad HTML" }), { status: 400 })
        : new Response(JSON.stringify({ ok: true }), { status: 200 })
    },
    name: "opensource_update",
    now: () => times.shift() ?? new Date(125_000),
  })

  expect(result.success).toBe(true)
  if (!result.success) return
  expect(captions[0]).toContain("<b>opensource_update</b>: in 125s ✅")
  expect(captions[0]).toContain("* 5 updated: x, y, z")
  expect(captions[0]).toContain("* 23 unchanged")
  expect(captions[0]).not.toContain("created=0")
  expect(captions[1]).toContain("opensource_update: in 125s ✅")
  expect(captions[1]).toContain("* 5 updated: x, y, z")
  expect(captions[1]).toContain("* 23 unchanged")
})

test("does not notify a marked successful repository summary when every count is zero", async () => {
  const directory = await testDirectory()
  let fetchCalls = 0
  const result = await telegramTimerRun({
    command: commandFor("console.log('== summary: created=0 updated=0 unchanged=0'); console.log('UPDATE_APPLIED=1')"),
    configuration: { botToken: "token", chatId: "chat" },
    env: { HOME: directory, XDG_CONFIG_HOME: directory },
    fetch: async () => {
      fetchCalls += 1
      return new Response(JSON.stringify({ ok: true }))
    },
    name: "leo_customers_update",
  })

  expect(result.success).toBe(true)
  if (!result.success) return
  expect(result.data.notificationAttempted).toBe(false)
  expect(fetchCalls).toBe(0)
})

test("alerts on command failure even when its repository summary counts are all zero", async () => {
  const directory = await testDirectory()
  let fetchCalls = 0
  const result = await telegramTimerRun({
    command: commandFor(
      "console.log('== summary: created=0 updated=0 unchanged=0'); console.log('UPDATE_APPLIED=1'); process.exit(1)",
    ),
    configuration: { botToken: "token", chatId: "chat" },
    env: { HOME: directory, XDG_CONFIG_HOME: directory },
    fetch: async () => {
      fetchCalls += 1
      return new Response(JSON.stringify({ ok: true }))
    },
    name: "leo_customers_update",
  })

  expect(result.success).toBe(true)
  if (!result.success) return
  expect(result.data.notificationAttempted).toBe(true)
  expect(fetchCalls).toBe(1)
})

test("preserves the legacy single-updater summary", async () => {
  const directory = await testDirectory()
  let caption = ""
  const result = await telegramTimerRun({
    command: commandFor("console.log('- cache: 1.0 -> 2.0'); console.log('UPDATE_APPLIED=1')"),
    configuration: { botToken: "token", chatId: "chat" },
    env: { HOME: directory, XDG_CONFIG_HOME: directory },
    fetch: async (_input, init) => {
      caption = String((init?.body as FormData).get("caption"))
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    },
    name: "legacy updater",
  })

  expect(result.success).toBe(true)
  expect(caption).toContain("<b>legacy updater</b>: 1.0 -&gt; 2.0 in")
  expect(caption).not.toContain("packages updated")
})

test("renders structured single-update versions and labeled safe links in HTML and plain fallback", async () => {
  const directory = await testDirectory()
  const captions: string[] = []
  const result = await telegramTimerRun({
    command: commandFor(
      `console.log(${JSON.stringify('UPDATE_SUMMARY={"name":"Bun <stable>","from":"1.2&","to":"1.3","releaseUrl":"https://example.com/releases/1.3?a=1&b=2","changelogUrl":"javascript:alert(1)","compareUrl":"https://example.com/compare/1.2...1.3"}')}); console.log('UPDATE_APPLIED=1')`,
    ),
    configuration: { botToken: "token", chatId: "chat" },
    env: { HOME: directory, XDG_CONFIG_HOME: directory },
    fetch: async (_input, init) => {
      captions.push(String((init?.body as FormData).get("caption")))
      return captions.length === 1
        ? new Response(JSON.stringify({ ok: false, description: "bad HTML" }), { status: 400 })
        : new Response(JSON.stringify({ ok: true }), { status: 200 })
    },
    name: "bun updater",
  })

  expect(result.success).toBe(true)
  expect(captions).toHaveLength(2)
  expect(captions[0]).toContain("<b>Bun &lt;stable&gt;</b>")
  expect(captions[0]).toContain("1.2&amp; -&gt; 1.3")
  expect(captions[0]).toContain('<a href="https://example.com/releases/1.3?a=1&amp;b=2">Release</a>')
  expect(captions[0]).toContain('<a href="https://example.com/compare/1.2...1.3">Changes</a>')
  expect(captions[0]).not.toContain("javascript:")
  expect(captions[1]).toContain("bun updater: Bun <stable> in")
  expect(captions[1]).toContain("1.2& -> 1.3")
  expect(captions[1]).toContain("Release: https://example.com/releases/1.3?a=1&b=2")
  expect(captions[1]).not.toContain("javascript:")
})

test("renders structured batch entries compactly and suppresses metadata-only successful no-ops", async () => {
  const directory = await testDirectory()
  let caption = ""
  const changed = await telegramTimerRun({
    command: commandFor(
      `console.log(${JSON.stringify('UPDATE_SUMMARY={"name":"System updates","items":[{"name":"openssl","from":"3.0","to":"3.1","changelogUrl":"https://example.com/openssl"},{"name":"curl","from":"8.0","to":"8.1","releaseUrl":"https://example.com/curl"}]}')}); console.log('UPDATE_APPLIED=1')`,
    ),
    configuration: { botToken: "token", chatId: "chat" },
    env: { HOME: directory, XDG_CONFIG_HOME: directory },
    fetch: async (_input, init) => {
      caption = String((init?.body as FormData).get("caption"))
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    },
    name: "system update",
  })
  expect(changed.success).toBe(true)
  expect(caption).toContain("<b>System updates</b>")
  expect(caption).toContain("openssl: 3.0 -&gt; 3.1")
  expect(caption).toContain("curl: 8.0 -&gt; 8.1")
  expect(caption).toContain(">Changelog</a>")
  expect(caption).toContain(">Release</a>")

  let fetchCalls = 0
  const noOp = await telegramTimerRun({
    command: commandFor(`console.log('UPDATE_SUMMARY={"name":"no-op","releaseUrl":"https://example.com"}')`),
    configuration: { botToken: "token", chatId: "chat" },
    env: { HOME: directory, XDG_CONFIG_HOME: directory },
    fetch: async () => {
      fetchCalls += 1
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    },
    name: "no-op",
  })
  expect(noOp.success).toBe(true)
  if (noOp.success) expect(noOp.data.notificationAttempted).toBe(false)
  expect(fetchCalls).toBe(0)
})

test("keeps structured failure reports useful without links or versions", async () => {
  const directory = await testDirectory()
  let caption = ""
  const result = await telegramTimerRun({
    command: commandFor(`console.log('UPDATE_SUMMARY={"name":"Registry refresh"}'); process.exit(9)`),
    configuration: { botToken: "token", chatId: "chat" },
    env: { HOME: directory, XDG_CONFIG_HOME: directory },
    fetch: async (_input, init) => {
      caption = String((init?.body as FormData).get("caption"))
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    },
    name: "registry updater",
  })
  expect(result.success).toBe(true)
  expect(caption).toContain("<b>Registry refresh</b> in")
  expect(caption).toContain("❌")
  expect(caption).toContain("❌")
  expect(caption).not.toContain("exit:")
  expect(caption).not.toContain("<pre>")
})

test("keeps all 21 shared-policy package details when caption metadata exceeds the limit", async () => {
  const directory = await testDirectory()
  const packageNames = [
    "svgo",
    "vite",
    "@rsbuild/core",
    "@adaptive-ds/forgejo-cli",
    "@adaptive-ds/project-registry",
    "@adaptive-ds/zitadel-cli",
    "@adaptive-ds/telegram-send",
    "@adaptive-ds/result",
    "valibot",
    "david1gp/codex-imagen",
    "mmx-cli",
    "ctx7@latest",
    "@biomejs/biome",
    "prettier",
    "wrangler",
    "typescript",
    "agent-browser",
    "playwright",
    "@bitwarden/cli@2024.12.0",
    "t3@latest",
    "@earendil-works/pi-coding-agent",
  ]
  const outputLines = packageNames.map((name) => `console.log(${JSON.stringify(`- ${name}: 1 -> 2, patch`)})`)
  outputLines.push("console.log('UPDATE_APPLIED=1')")
  const captions: string[] = []
  const times = [new Date(0), new Date(8_000)]
  const result = await telegramTimerRun({
    command: commandFor(outputLines.join("; ")),
    configuration: { botToken: "token", chatId: "chat" },
    env: { HOME: directory, HOSTNAME: "h".repeat(700), XDG_CONFIG_HOME: directory },
    fetch: async (_input, init) => {
      captions.push(String((init?.body as FormData).get("caption")))
      return captions.length === 1
        ? new Response(JSON.stringify({ ok: false, description: "bad HTML" }), { status: 400 })
        : new Response(JSON.stringify({ ok: true }), { status: 200 })
    },
    name: "bun_update_global",
    now: () => times.shift() ?? new Date(8_000),
  })

  expect(result.success).toBe(true)
  if (!result.success) return
  expect(result.data.exitCode).toBe(0)
  expect(captions).toHaveLength(2)
  expect(captions[0]?.length).toBeLessThanOrEqual(1024)
  expect(captions[0]).toContain("21 packages updated in 8s")
  expect(captions[0]).not.toContain("<pre>")
  expect(captions[1]?.length).toBeLessThanOrEqual(1024)
  expect(captions[1]).toContain("21 packages updated in 8s")
  expect(captions[1]).not.toContain("\njob:")
  for (const name of packageNames) {
    expect(captions[0]).toContain(`- ${name}: 1 -&gt; 2, patch`)
    expect(captions[1]).toContain(`- ${name}: 1 -> 2, patch`)
  }
})

test("bounds the header fallback for oversized job, prefix, and structured title values", async () => {
  const directory = await testDirectory()
  const captions: string[] = []
  const output = `UPDATE_SUMMARY=${JSON.stringify({ name: "<title>&".repeat(300), to: "2" })}\nUPDATE_APPLIED=1`
  const result = await telegramTimerRun({
    command: commandFor(`console.log(${JSON.stringify(output)})`),
    configuration: { botToken: "token", chatId: "chat" },
    env: {
      HOME: directory,
      TG_TIMER_PREFIX: "<b>prefix & </b>".repeat(300),
      XDG_CONFIG_HOME: directory,
    },
    fetch: async (_input, init) => {
      captions.push(String((init?.body as FormData).get("caption")))
      return captions.length === 1
        ? new Response(JSON.stringify({ ok: false, description: "retry as plain" }), { status: 400 })
        : new Response(JSON.stringify({ ok: true }), { status: 200 })
    },
    name: "<job>&".repeat(30),
  })

  expect(result.success).toBe(true)
  expect(captions).toHaveLength(2)
  expect(captions[0]?.length).toBeLessThanOrEqual(1024)
  expect(captions[1]?.length).toBeLessThanOrEqual(1024)
  expect(captions[0]).toBe("Timer report")
  expect(captions[1]).toBe("Timer report")
})

test("does not promote unchanged classified packages and deduplicates repeated package details", async () => {
  const directory = await testDirectory()
  let caption = ""
  const result = await telegramTimerRun({
    command: commandFor(
      [
        "console.log('- vite: 1.0.0 -> 2.0.0, patch')",
        "console.log('- vite: 1.0.0 -> 2.0.0, patch')",
        "console.log('- bun: 1.4.2 -> 1.4.2, unchanged')",
        "console.log('- bun: 1.4.2 -> 1.4.2, unchanged')",
        "console.log('UPDATE_APPLIED=1')",
      ].join("; "),
    ),
    configuration: { botToken: "token", chatId: "chat" },
    env: { HOME: directory, XDG_CONFIG_HOME: directory },
    fetch: async (_input, init) => {
      caption = String((init?.body as FormData).get("caption"))
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    },
    name: "bun_update_global",
  })

  expect(result.success).toBe(true)
  expect(caption).toContain("1 package updated")
  const summary = caption
  expect(summary.match(/- vite:/g)).toHaveLength(1)
  expect(summary).not.toContain("- bun:")
  expect(summary).not.toContain("1.4.2 -> 1.4.2")
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
