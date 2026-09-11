import { expect, test } from "bun:test"
import pkg from "../package.json" with { type: "json" }

const projectRoot = `${import.meta.dir}/..`

async function runCli(entrypoint: string, args: readonly string[]) {
  const child = Bun.spawn(["bun", "run", `./src/${entrypoint}`, ...args], {
    cwd: projectRoot,
    env: { HOME: process.env.HOME ?? "/tmp", PATH: process.env.PATH ?? "" },
    stderr: "pipe",
    stdout: "pipe",
  })
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])
  return { exitCode: await child.exited, stderr, stdout }
}

test.each([
  ["cli.ts", "tg"],
  ["timerCli.ts", "tg-timer"],
] as const)("%s --version reports the package version", async (entrypoint) => {
  const result = await runCli(entrypoint, ["--version"])

  expect(result.exitCode).toBe(0)
  expect(result.stdout).toBe(`${pkg.version}\n`)
  expect(result.stderr).toBe("")
})

test.each([
  ["cli.ts", "tg"],
  ["timerCli.ts", "tg-timer"],
] as const)(
  "%s --version --verbose reports local metadata without starting work",
  async (entrypoint, executableName) => {
    const result = await runCli(entrypoint, ["--version", "--verbose"])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe("")
    expect(result.stdout).toContain(`${executableName} ${pkg.version}\n`)
    expect(result.stdout).toContain(`user agent: ${pkg.name}/${pkg.version}`)
    expect(result.stdout).toContain(`description: ${pkg.description}`)
    expect(result.stdout).toContain(`author: ${pkg.author.name}`)
    expect(result.stdout).toContain(`license: ${pkg.license}`)
    expect(result.stdout).toContain(`project: ${pkg.homepage}`)
    expect(result.stdout).toContain("installation type: development checkout")
    expect(result.stdout).toContain("runtime: bun ")
    expect(result.stdout).toContain(
      `runtime requirements: ${Object.entries(pkg.engines)
        .map(([runtime, requirement]) => `${runtime} ${requirement}`)
        .join(", ")}`,
    )
    expect(result.stdout).toContain(`platform: ${process.platform} ${process.arch} (OS release `)
    expect(result.stdout).toMatch(/executable: .+\nexecutable target: .+\n/)
    expect(result.stdout).not.toContain("build")
  },
)
