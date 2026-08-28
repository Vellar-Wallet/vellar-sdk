# Contributing to the Vellar SDK

Thanks for your interest in contributing! Please read these rules before you
start — pull requests that don't follow them will be closed.

## The rules

1. **Fork the repo and work from your fork.** Clone your fork, make your
   changes on a branch there, and push to your fork. Never push to this
   repository directly.

   ```sh
   gh repo fork Vellar-Wallet/vellar-sdk --clone
   cd vellar-sdk
   git checkout dev
   git checkout -b my-change
   # ...work, commit...
   git push -u origin my-change
   ```

2. **All pull requests must target the `dev` branch — never `main`.**
   When you open a PR, set the base branch to `dev`. PRs opened against
   `main` are automatically retargeted to `dev` by a bot (your work is kept,
   you don't need to reopen anything — just set the base to `dev` yourself
   next time). `main` is the release branch and is managed by maintainers
   only.

3. **Contributor changes must stay inside `contrib/`.** External PRs that
   touch any file outside `contrib/` are closed automatically by a bot, even
   if they also target `dev` correctly. See [contrib/README.md](contrib/README.md)
   for what belongs there. If your assigned issue genuinely requires changes
   elsewhere in the codebase, say so on the issue before starting — a
   maintainer will make that change or explicitly widen your scope.

4. **Only work on issues assigned to you.** If you want to pick something up,
   comment on the issue and wait to be assigned before starting. Unsolicited
   PRs for unassigned issues will be closed.

5. **Questions go to the Telegram group.** Don't open issues for questions —
   ask in [our Telegram](https://t.me/+RWPCKXXJTj45Njk0).

## Supply-chain hardening & dependency policy

All runtime and development dependencies must be **pinned to exact versions** (no `^` or `~` ranges) in `package.json` to defend against supply-chain attacks and unexpected upstream releases:

```sh
npm run check:pinned
```

PRs introducing unpinned dependencies will fail the CI check.

## Before you open a PR

Make sure the package still typechecks, tests, and builds:

```sh
npm install
npm run typecheck
npm test
npm run check:pinned
npm run build
```

New code is expected to come with tests.

