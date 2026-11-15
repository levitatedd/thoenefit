#!/usr/bin/env bash
# Prints the human-readable app version for the commit being deployed.
#
#   .github/scripts/app-version.sh main      -> 0.1.104
#   .github/scripts/app-version.sh staging   -> 0.1.105-staging
#
# VERSION holds the starting number (for example 0.1.100). The patch number then
# goes up by one for every commit on main's first-parent line after the commit
# that last changed VERSION, so each release merged into main counts once, however
# many commits it brings from staging. To start a new minor or major version, set
# VERSION to it (for example 0.2.0); counting restarts from the release that ships it.
#
# Staging shows the number the next release will get, with -staging on the end.
# Needs the full history of main (actions/checkout with fetch-depth: 0).
set -euo pipefail

branch="${1:?usage: app-version.sh main|staging}"
main_ref="${MAIN_REF:-origin/main}"

start_of() { # VERSION as of a commit, checked
  local v
  v="$(git show "$1:VERSION" 2>/dev/null | tr -d '[:space:]')" || return 1
  [[ "$v" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "VERSION must look like 0.1.100, not '$v'." >&2; exit 1; }
  printf '%s' "$v"
}

released() { # the version a commit on main's first-parent line was released as
  local ref="$1" start base count
  start="$(start_of "$ref")"
  base="$(git log --first-parent -1 --format=%H "$ref" -- VERSION)"
  count="$(git rev-list --count --first-parent "$base..$ref")"
  printf '%s.%s' "${start%.*}" "$(( ${start##*.} + count ))"
}

git cat-file -e HEAD:VERSION 2>/dev/null || { echo "This commit has no VERSION file." >&2; exit 1; }

case "$branch" in
  main)
    released HEAD
    ;;
  staging)
    here="$(start_of HEAD)"
    if main_start="$(start_of "$main_ref")" && [[ "$main_start" == "$here" ]]; then
      current="$(released "$main_ref")"
      next="${current%.*}.$(( ${current##*.} + 1 ))"
    else
      next="$here" # VERSION is new or changed on staging: the next release starts there
    fi
    printf '%s-staging' "$next"
    ;;
  *)
    echo "Unknown branch '$branch'. Use main or staging." >&2
    exit 1
    ;;
esac
echo
