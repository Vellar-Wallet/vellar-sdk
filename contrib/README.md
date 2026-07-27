# Contributor Sandbox

This folder is the **only place** external contributor PRs may touch.

A PR against the `drips` branch that changes any file outside `contrib/` is
closed automatically — see `.github/workflows/close-prs-outside-contrib.yml`
and [CONTRIBUTING.md](../CONTRIBUTING.md) for the full contribution rules.

Maintainers (repo owner, org members, collaborators) are exempt from this
restriction, same as the existing `main`-targeting guard.

## What goes here

Whatever the assigned issue asks for: standalone example code, mock route
handlers, or self-contained reference implementations that do not require
editing `src/`, `website/`, or the package config directly. If your assigned
issue genuinely requires changes outside `contrib/`, say so on the issue
before starting — don't open a PR that touches other folders; it will be
closed unread.
