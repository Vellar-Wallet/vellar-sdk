# Contributor Sandbox

This folder is the **only place** external contributor PRs may touch.

A PR against the `drips` branch that changes any file outside `contrib/` is
closed automatically — see `.github/workflows/close-prs-outside-contrib.yml`
and [CONTRIBUTING.md](../CONTRIBUTING.md) for the full contribution rules.

Maintainers (repo owner, org members, collaborators) are exempt from this
restriction, same as the existing `main`-targeting guard.

## Branch strategy (so this doesn't drift again)

Three branches, three purposes:

- **`main`**: the stable, released branch. Far behind `dev`; nothing lands
  here directly.
- **`dev`**: the primary integration branch maintainers merge everything
  into. This is where non-contributor (maintainer) work targets.
- **`drips`**: a sandbox branched off `dev`, kept updated with merged
  contributor work, and the **only** base branch external contributor PRs may
  target. This keeps the `contrib/`-only guard
  (`close-prs-outside-contrib.yml`) scoped to PRs actually opened by outside
  contributors, without needing to distinguish maintainer commits from
  contributor commits on `dev` itself.

If you're an external contributor: always target `drips`, per the rest of
this file and `CONTRIBUTING.md`. If you're a maintainer merging contributor
work or your own changes into the main development line: target `dev`. `main`
is not a target for either.

## What goes here

Whatever the assigned issue asks for: standalone example code, mock route
handlers, or self-contained reference implementations that do not require
editing `src/`, `website/`, or the package config directly. If your assigned
issue genuinely requires changes outside `contrib/`, say so on the issue
before starting — don't open a PR that touches other folders; it will be
closed unread.
