# License and Versioning

> The license for each component, the versioning signals used in these docs, and
> where to find the changelog.

By the end of this page you will know which license covers each component, what
the version requirements in these docs mean, and where the changelog lives.

## Licenses

Vellar is not one repository. Each component carries its own license, and a
reviewer deciding whether to depend on Vellar needs to check the one that
covers the piece they are actually taking.

| Component | License | Source |
| --- | --- | --- |
| `vellar-sdk` (published on npm) | MIT | [github.com/Vellar-Wallet/vellar-sdk](https://github.com/Vellar-Wallet/vellar-sdk) |
| The Vellar facilitator | Apache-2.0 | [github.com/Vellar-Wallet/vellar-facilitator](https://github.com/Vellar-Wallet/vellar-facilitator) |
| The Vellar explorer | Apache-2.0 | [github.com/Vellar-Wallet/vellar-explorer](https://github.com/Vellar-Wallet/vellar-explorer) |

> **Note:** The identifiers above are what each repository declares. Read the
> `LICENSE` file in the repository you are depending on and rely on that rather
> than on this table, which is a summary and can fall behind.

The explorer is a separate open-source repository rather than a component of
the facilitator. It reads ledger data directly and asks the facilitator
nothing, so its license and its release cadence are independent. See
[Explorer](./explorer.md).

## The vendored upto contract

The `upto` settlement contract vendored at `contracts/upto-stellar/` in the
facilitator repository is Apache-2.0, credited to rail402
([tolgayayci/rail402](https://github.com/tolgayayci/rail402)) at commit
`ff504b85ac065369dc985759afe4164a4541d861`. The full attribution lives in
[`contracts/upto-stellar/PROVENANCE.md`](https://github.com/Vellar-Wallet/vellar-facilitator/blob/main/contracts/upto-stellar/PROVENANCE.md)
in the facilitator repo.

This matters because the vendored code is third-party code running in the
settlement path, not a Vellar original. The provenance file is the record of
where it came from.

The deployed artifact, so the license note can be tied to something verifiable:

| Field | Value |
| --- | --- |
| Contract id (testnet) | `CDHPA64M73TUTEM4MMHIWIXINBQXH7JJXFGZMGH22VJWFJFROMR6QV2S` |
| Wasm sha256 | `c276b905981eab91704ce9b9046ebb4867b164dd7e4ba0e0ecda841527d398a9` |
| Deployed | 2026-08-21 |

## Version signals in these docs

Where a page says a feature needs a minimum SDK version, it means the API did
not exist, or did not behave as described, before that release.

| Minimum version | Feature |
| --- | --- |
| `>= 0.4.0` | `wallet.x402` payments |
| `>= 0.5.0` | `wallet.agents` (agent keys) |
| `>= 0.6.1` | `rpcUrl` validation at construction |

> ⚠️ **APIs may change before 1.0.** Pin a version rather than tracking the
> latest release, and read the changelog before upgrading. Breaking changes are
> noted there.

## Changelog

For the SDK, `CHANGELOG.md` in the `vellar-sdk` repository is the record of what
changed in each release.

For the facilitator there is no single changelog file. Use the git log for the
sequence of changes, and `docs/decisions.md`, which records significant findings
and decisions chronologically. The decisions file is the better read of the two
if you want to know why something is the way it is rather than when it landed.

## When it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| `wallet.x402` is missing on the wallet handle | The installed SDK is older than 0.4.0 | Upgrade `vellar-sdk` to `>= 0.4.0` |
| `wallet.agents` is missing | The installed SDK is older than 0.5.0 | Upgrade `vellar-sdk` to `>= 0.5.0` |
| A bad `rpcUrl` is not rejected when the wallet is constructed, and fails later instead | The installed SDK is older than 0.6.1, so the URL is not validated at construction | Upgrade `vellar-sdk` to `>= 0.6.1` |

## Next steps

- [Introduction](../getting-started/introduction.md)
- [Installation](../getting-started/installation.md)
- [Security](../security.md)
- [Honesty](./honesty.md)
