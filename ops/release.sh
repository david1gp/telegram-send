#!/usr/bin/env bash
set -euo pipefail

changelogs_dir="changelogs"
package_json="package.json"
repository="david1gp/telegram-send"

if [[ $# -gt 1 ]]; then
  printf 'Error: provide zero or one argument for the next version.\n' >&2
  exit 1
fi

current_version="$(jq -r '.version' "$package_json")"
changelog_body="$(git cliff --unreleased --strip all | sed '1{/^## \[unreleased\]$/d};2{/^$/d}')"

if [[ -z "$changelog_body" || "$changelog_body" == *"No commits found"* ]]; then
  printf 'No new commits since the last release.\n' >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  printf 'Error: GitHub CLI is not installed or unavailable.\n' >&2
  exit 1
fi

if ! gh auth status --hostname github.com >/dev/null 2>&1; then
  printf 'Error: GitHub CLI is not authenticated for github.com.\n' >&2
  exit 1
fi

if [[ $# -eq 1 ]]; then
  new_version="$1"
else
  IFS='.' read -r major minor patch <<<"$current_version"
  if [[ "$changelog_body" == *"### Features"* ]]; then
    new_version="$major.$((minor + 1)).0"
  else
    new_version="$major.$minor.$((patch + 1))"
  fi
fi

date_now="$(date +%Y-%m-%d)"
changelog_file="$changelogs_dir/${date_now}_v${new_version}.md"
mkdir -p "$changelogs_dir"
printf '## [%s] - %s\n\n%s\n' "$new_version" "$date_now" "$changelog_body" >"$changelog_file"

jq --arg version "$new_version" '.version = $version' "$package_json" >"$package_json.tmp"
mv "$package_json.tmp" "$package_json"
bun run build

tag="v$new_version"
git add "$changelog_file" "$package_json"
git commit -m "chore(release): $tag"
git tag -a "$tag" -m "Release $tag"
git push origin main
git push origin --tags
gh release create "$tag" --title "$tag" --notes-file "$changelog_file" --repo "$repository"
