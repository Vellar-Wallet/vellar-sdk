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
   git checkout drips
   git checkout -b my-change
   # ...work, commit...
   git push -u origin my-change
   ```

2. **All pull requests must target the `drips` branch — never `main`.**
   When you open a PR, set the base branch to `drips`. PRs opened against
   `main` are closed automatically by a bot. `main` is the release branch and
   is managed by maintainers only.

3. **Only work on issues assigned to you.** If you want to pick something up,
   comment on the issue and wait to be assigned before starting. Unsolicited
   PRs for unassigned issues will be closed.

4. **Questions go to the Telegram group.** Don't open issues for questions —
   ask in [our Telegram](https://t.me/+RWPCKXXJTj45Njk0).

## Before you open a PR

Make sure the package still typechecks, tests, and builds:

```sh
npm install
npm run typecheck
npm test
npm run build
```

New code is expected to come with tests.
