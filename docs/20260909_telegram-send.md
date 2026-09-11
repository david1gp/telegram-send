# Goal
Create `@adaptive-ds/telegram-send`: a Bun/TypeScript CLI and library replacing the existing `tg` and `tg-timer`, published as a public MIT GitHub repository.

# Decisions
- Use `@stricli/core` for CLI parsing and follow the code-style skill.
- Preserve the existing message/document, environment configuration, silent/alert, HTML, and timer notification behavior from `/home/david/leo/leo-server/linux_timers/shared/telegram`.
- Use `/home/david/adaptive/forgejo-cli` as the configuration and automation template.
- Repository: `david1gp/telegram-send`; package: `@adaptive-ds/telegram-send`.
- Prefer existing sibling dependencies and Bun APIs.
- Run real notification tests with the Telegram credentials configured on `david-server`; verify summary and log formatting without exposing credentials.

# Approach
Establish package/configuration, implement sending, implement timer wrapping, document and verify, then commit and publish to GitHub.

# Tasks
1. Complete: Copy/adapt requested configuration files and package metadata, scripts, workspace, MIT license, build and release setup.
2. Complete: Implement Telegram sending library and Stricli `tg` CLI with Bun tests.
3. Complete: Implement timer library and Stricli `tg-timer` CLI with Bun tests.
4. Complete: Write README and verify integration, formatting, type checks, tests, build, package contents, and real `david-server` Telegram notification formatting.
5. Complete: Initialize Git, create initial semantic commit, create public GitHub repository and push.
