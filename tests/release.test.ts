import { afterEach, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { chmod, mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const releaseScript = join(import.meta.dir, "../ops/release.sh")
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

const writeExecutable = async (path: string, contents: string) => {
  await Bun.write(path, contents)
  await chmod(path, 0o755)
}

const createReleaseFixture = async (changelogOutput: string, withGh: boolean) => {
  const directory = await mkdtemp(join(tmpdir(), "telegram-send-release-test-"))
  temporaryDirectories.push(directory)
  const binDirectory = join(directory, "bin")
  await mkdir(binDirectory)

  const changelogPath = join(directory, "changelog-output")
  const ghLogPath = join(directory, "gh.log")
  const gitLogPath = join(directory, "git.log")
  const bunLogPath = join(directory, "bun.log")
  await Bun.write(join(directory, "package.json"), '{"version":"0.2.0"}\n')
  await Bun.write(changelogPath, changelogOutput)
  await Bun.write(ghLogPath, "")
  await Bun.write(gitLogPath, "")
  await Bun.write(bunLogPath, "")

  await symlink("/usr/bin/jq", join(binDirectory, "jq"))
  await symlink("/usr/bin/sed", join(binDirectory, "sed"))
  await writeExecutable(
    join(binDirectory, "git"),
    `#!/bin/bash
if [[ "$1" == "cliff" ]]; then
  while IFS= read -r line; do printf '%s\\n' "$line"; done < "$CLIFF_OUTPUT"
  exit 0
fi
printf '%s\\n' "$*" >> "$GIT_LOG"
exit 0
`,
  )
  await writeExecutable(join(binDirectory, "bun"), '#!/bin/bash\nprintf \'%s\\n\' "$*" >> "$BUN_LOG"\nexit 0\n')

  if (withGh) {
    await writeExecutable(join(binDirectory, "gh"), '#!/bin/bash\nprintf \'%s\\n\' "$*" >> "$GH_LOG"\nexit 1\n')
  }

  return {
    directory,
    env: {
      ...process.env,
      PATH: binDirectory,
      CLIFF_OUTPUT: changelogPath,
      GH_LOG: ghLogPath,
      GIT_LOG: gitLogPath,
      BUN_LOG: bunLogPath,
    },
    ghLogPath,
    gitLogPath,
    bunLogPath,
  }
}

const runRelease = async (fixture: Awaited<ReturnType<typeof createReleaseFixture>>) => {
  const process = Bun.spawn(["/bin/bash", releaseScript], {
    cwd: fixture.directory,
    env: fixture.env,
    stderr: "pipe",
    stdout: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  return { exitCode, stdout, stderr }
}

test.serial("no-release exits before requiring an unavailable gh", async () => {
  const fixture = await createReleaseFixture("No commits found\n", false)
  const result = await runRelease(fixture)

  expect(result.exitCode).toBe(1)
  expect(result.stderr).toContain("No new commits since the last release.")
  expect(result.stderr).not.toContain("GitHub CLI")
  expect(await readFile(fixture.ghLogPath, "utf8")).toBe("")
})

test.serial("no-release does not invoke a failing gh command", async () => {
  const fixture = await createReleaseFixture("No commits found\n", true)
  const result = await runRelease(fixture)

  expect(result.exitCode).toBe(1)
  expect(result.stderr).toContain("No new commits since the last release.")
  expect(result.stderr).not.toContain("not authenticated")
  expect(await readFile(fixture.ghLogPath, "utf8")).toBe("")
})

test.serial("real release checks gh auth before release side effects", async () => {
  const fixture = await createReleaseFixture("## [unreleased]\n\n### Features\n\n- feature\n", true)
  const result = await runRelease(fixture)

  expect(result.exitCode).toBe(1)
  expect(result.stderr).toContain("GitHub CLI is not authenticated for github.com.")
  expect(await readFile(fixture.ghLogPath, "utf8")).toBe("auth status --hostname github.com\n")
  expect(await readFile(fixture.gitLogPath, "utf8")).toBe("")
  expect(await readFile(fixture.bunLogPath, "utf8")).toBe("")
  expect(existsSync(join(fixture.directory, "changelogs"))).toBe(false)
  expect(await readFile(join(fixture.directory, "package.json"), "utf8")).toBe('{"version":"0.2.0"}\n')
})
