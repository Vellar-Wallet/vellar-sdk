# Vellar × Stellar Hackathon

Everything you need to build, submit, and get judged. Read this fully before
you start.

> **$500 in prizes.** Online, Aug 29–31, 2026. Build solo or as a team of up to
> 4. Submit a public GitHub repo using `vellar-sdk`.

---

## Before You Do Anything Else

Following [**@vellar_sdk on X**](https://x.com/vellar_sdk?s=11) is **mandatory**
to participate. This is checked at registration, and if you haven't followed,
your registration will not be approved.

**Want better odds?** Repost the hackathon banner from our X page with a
caption like *"I'm building at the Vellar × Stellar Hackathon"* and tag
[@vellar_sdk](https://x.com/vellar_sdk?s=11). It's optional, and it does
**not** change your score on the judging rubric, but it's the single easiest
way to get your project in front of the Vellar community before you've even
submitted. Judges and mentors follow the tag, standout build-in-public threads
get reshared on our page during the weekend, and in the event of a close tie
between two similarly-scored projects, visible momentum and community buzz can
be the deciding factor. Free exposure, zero downside.

---

## Quick Summary

1. Follow [**@vellar_sdk**](https://x.com/vellar_sdk?s=11) on X, mandatory, checked at registration.
2. Build something real using [`vellar-sdk`](https://www.npmjs.com/package/vellar-sdk): passkey wallets, on-chain policies, or x402 agent payments.
3. Put all your code in a **public GitHub repo** with a complete README.
4. Open a **GitHub Issue** on the submission repo using the template below.
5. Submit before the deadline. Late submissions are not judged.

---

## What to Build

Anything using `vellar-sdk`. We want the boldest, most creative ideas for the
Stellar ecosystem, not a clone of an existing product with Vellar bolted on.
Pick **one** track at submission; your project is judged only in that track.

### Track 1, Wallet SDK

Passkey onboarding, payments, or any app built on top of a Vellar smart
account. This is the open lane, the strongest, most original product wins,
regardless of which SDK surface it leans on hardest.

**Build things like:** a consumer payments app, a merchant checkout flow, a
savings/goals product, a tipping or micropayments tool, anything where
"create a wallet with a fingerprint, not a seed phrase" is the unlock. These
are starting points, not the ceiling, the strongest submissions will surprise
us.

**Key SDK surface:** `createVellarWallet`, `.create()`, `.connect()`, `.pay()`.
See [Quickstart](./quickstart.md).

### Track 2, Policy Builder

Programmable on-chain spending controls, built on `wallet.policies`. Vellar
smart accounts are Soroban contracts, so policies are enforced **on-chain**,
not just in your UI.

**Build things like:** a shared/family wallet with per-member spending caps, a
sub-account or allowance system, a treasury tool with multisig-style
approval, a budgeting app that makes the on-chain cap visible and trustworthy.
These are starting points, not the ceiling, the strongest submissions will
surprise us.

**Key SDK surface:** `wallet.policies` (templates, generate, simulate, deploy).
See [Policies](./policies.md).

### Track 3, x402 Agent Payments

**"Give your agent a budget, not your keys."** An autonomous agent holds a
scoped session key and pays for HTTP-402 resources on its own, capped
on-chain by a spending-limit policy. The agent never holds your passkey and
cannot spend past its cap.

**Build things like:** an agent that shops for API access on a budget, a
bot that pays-per-call for data/compute and stops when it hits its cap, a
multi-agent system where each agent has its own bounded wallet. These are
starting points, not the ceiling, the strongest submissions will surprise us.

**Key SDK surface:** `wallet.x402.fetch()`, `createSessionKeySigner`. See
[x402 Agentic Payments](./x402.md).

> **Scope note:** this track is specifically about **agent (session-key)
> payments**, the proven, working path. Human passkey-signed x402 payments
> are not yet supported by any deployed facilitator; don't build around that
> path, it will not settle.

### Track 4, Open Innovation

The catch-all for anything strong that doesn't fit neatly into Tracks 1
through 3, or that combines more than one SDK surface into something new.
Genuinely novel angles on passkeys, policies, or agent payments, or a project
that uses all three together, belong here.

**Build things like:** anything genuinely creative that uses `vellar-sdk` in a
way we haven't listed above. This track exists so a great idea never gets
forced into the wrong box.

**Key SDK surface:** any combination of the above. See
[Wallet Methods](./wallet-methods.md) for the full API surface.

### Can't decide?

```
Is the core flow "onboard/pay with a passkey"?        > Track 1
Is the core flow "enforce a spending rule on-chain"?   > Track 2
Is the core flow "an agent pays for something itself"? > Track 3
Something else strong that doesn't fit cleanly above?  > Track 4
```

If your idea genuinely spans two tracks, submit to the one where your core
flow lives, not a secondary feature.

---

## Judging

### Philosophy

We reward **real, working products that use Vellar meaningfully**, not the
most lines of code, and not the most ambitious pitch deck. A rough but working
demo beats a polished idea with nothing to show.

### Scoring criteria

Every project is scored on 6 criteria, 100 points total.

| # | Criterion | Weight | What judges ask |
|---|---|---|---|
| 1 | **Meaningful use of vellar-sdk** | 25 | Is `vellar-sdk` core to the product, passkeys, policies, or x402, or just a login screen bolted onto something unrelated? |
| 2 | **Problem & real-world relevance** | 20 | Does this solve a real problem for a real user? Is there genuine demand? |
| 3 | **Functionality & completeness** | 20 | Does the core flow actually work end to end on testnet? Can a judge use it? |
| 4 | **Technical execution & code quality** | 15 | Is the code well-structured and documented? Is signing/submission handled correctly (simulate before sign, no silent signing, poll for finality)? |
| 5 | **Product thinking & UX** | 10 | Is it usable, not just conceptual? Are errors, empty states, and loading handled? |
| 6 | **Presentation & demo clarity** | 10 | Does the demo clearly show the core flow? Does the README explain scope and how to run it? |

### Bonus points (up to +10)

- **+4, Genuine innovation.** The idea is not an obvious/expected use of the
  SDK. Tell judges what makes it different in your submission.
- **+3, Multi-surface use.** Combines more than one SDK surface meaningfully
  (e.g. a policy-governed wallet that also does agent payments), not just
  imported side by side.
- **+3, Testnet-to-mainnet readiness.** A clear, credible path to production
  beyond "swap the network config."

### Scoring bands

| Score | Band | Meaning |
|---|---|---|
| 85–110 | Outstanding | Demo-ready, real product, strong SDK use. Prize contender. |
| 70–84 | Strong | Works well, clear value, minor gaps. |
| 55–69 | Solid | Core flow works, needs polish or deeper SDK use. |
| 40–54 | Early | Partial flow, promising direction, incomplete execution. |
| < 40 | Incomplete | Core flow does not run, or SDK use is superficial. |

### Prizes

$500 total, awarded to the top 3 overall projects across all tracks:

- 🥇 1st place
- 🥈 2nd place
- 🥉 3rd place

### Process

Fully async, there is no live/table judging.

1. Judges review each submission's repo, README, and demo video.
2. Each judge scores independently on the rubric above; scores are averaged.
3. Judges reconcile close scores and confirm bonus points.
4. Winners are announced in [Telegram](https://t.me/+JvRMWLJMWS0xYTBk).

---

## Eligibility

| Requirement | Detail |
|---|---|
| **Team size** | 1–4 builders. Solo is welcome. |
| **SDK** | Must use `vellar-sdk`. It must be core to the product, not cosmetic. |
| **Network** | Stellar testnet is required and sufficient. Mainnet is optional (`vellar-sdk` mainnet use is pending a security review, do not deploy real funds). |
| **Build window** | Must be built during the hackathon period (Aug 29–31, 2026). Starting from a stock scaffold (Next.js/Vite starter, the SDK's own quickstart snippet) is fine; submitting pre-existing personal or third-party projects is not. |
| **Originality** | Original work only. No re-use of pre-existing projects, no plagiarism. |
| **License** | Code must be published under a permissive open-source license (MIT, Apache-2.0, or similar). |

**Allowed and encouraged:** starter templates and scaffolds, the SDK's own
quickstart code as a base, AI coding tools, other open-source libraries.

**Not allowed:** submitting a pre-existing project as new hackathon work,
copying another team's or another hackathon's project, a barely-modified
example repo presented as your project.

A project **will be disqualified** if it doesn't actually use `vellar-sdk` in
any meaningful way, can't be run or demonstrated by judges, or is found to be
plagiarized or pre-existing work. If you're unsure whether something counts,
disclose it in your README, honesty is rewarded, hidden re-use is not.

---

## How to Submit

Your submission has **three parts**. All three are required.

### 1. A public GitHub repository

- Contains all of your project's code, not just a forked template.
- Includes a permissive open-source `LICENSE` file.
- Final work is on the `main` branch, that's what gets judged.

### 2. A complete README in that repo

Use the template below. A judge must be able to run your project from the
README alone.

### 3. A submission Issue

Open a GitHub Issue on the hackathon submission repo (link posted in
[Telegram](https://t.me/+JvRMWLJMWS0xYTBk) at kickoff) titled:

```
[Team Name] - [Project Name]
```

and fill in:

```markdown
## Project Name
[Your project name]

## One-Line Description
[What it does, in one sentence]

## Track
[Track 1: Wallet SDK | Track 2: Policy Builder | Track 3: x402 Agent Payments | Track 4: Open Innovation]

## Problem It Solves
[2-4 sentences. What real problem does this address? Who is the user?]

## How It Uses vellar-sdk
[Which SDK surfaces, create/connect/pay, wallet.policies, wallet.x402, and
why. Be specific. This maps to Judging criterion 1.]

## GitHub Repository
[Link to your public repo. Final code must be on the `main` branch.]

## Demo Video
[Link, 2-4 minutes, shows the core flow working]

## Network & Deployment
- Network: testnet
- Live app URL (if any): [link, or "runs locally, see README"]
- Contract IDs (if any): [list, or "N/A"]

## Team
- [Full Name], @[github-username]
- [up to 4 members]

## Anything Else
[Optional: known limitations, what you'd build next]
```

> One Issue per team. If you need to update your submission before the
> deadline, edit the same Issue, don't open a new one. The Issue's last-edit
> timestamp before the deadline is your official submission time.

### Project README template

Put this in **your project's own repo**, not the submission Issue.

```markdown
# [Project Name]

[One-line description]

## Problem
[What problem does this solve? Who has this problem?]

## How It Works
[The core user flow, in plain language. What does a user actually do?]

## How It Uses vellar-sdk
[Specific: create/connect/pay, policies, x402. Why vellar-sdk and not a
raw Stellar SDK integration?]

## Track
[Track 1: Wallet SDK | Track 2: Policy Builder | Track 3: x402 Agent Payments | Track 4: Open Innovation]

## Tech Stack
- Framework: [Next.js / React / ...]
- vellar-sdk: v[version]
- Network: testnet

## Setup & Run

\`\`\`bash
git clone [your repo]
cd [your project]
npm install
# .env
#   VELLAR_API_URL=https://vellar-backend.onrender.com
npm run dev
\`\`\`

## Team
- [Name], @[github-username]

## License
[MIT / Apache-2.0 / ...]
```

### Pre-submission checklist

- [ ] Code is pushed to a **public** GitHub repo, final work on `main`
- [ ] Repo has a **LICENSE** file (permissive)
- [ ] Repo has a complete **README** following the template above
- [ ] A judge could **run the project from the README alone**
- [ ] The project **actually runs** on Stellar testnet
- [ ] The **core user flow works end to end**, you tested it yourself
- [ ] `vellar-sdk` is **core** to the product, re-read criterion 1 above
- [ ] **Track** selected
- [ ] All **team members** listed with GitHub usernames
- [ ] **Demo video** recorded (2–4 minutes, shows the core flow)
- [ ] Submission **Issue** opened with the correct title and template filled in
- [ ] Submitted **before the deadline**

---

## Getting Started

1. Read [Introduction](./introduction.md) and [Quickstart](./quickstart.md).
2. `npm install vellar-sdk @stellar/stellar-sdk`, see [Installation](./installation.md).
3. Point your backend at the hosted gateway: `VELLAR_API_URL=https://vellar-backend.onrender.com`, see [How It Works](./how-it-works.md) for why a backend is needed.
4. Pick a track above and scope the **smallest strong version** of your idea.
5. Build. Ask questions in [Telegram](https://t.me/+JvRMWLJMWS0xYTBk).
6. Test your core flow on testnet, end to end, before recording your demo.
7. Record a 2–4 minute demo video.
8. Submit via GitHub Issue before the deadline.

---

## Tips to Score Well

- **Scope tight.** Build the smallest strong version of your core flow.
  Judges reward a working demo over a half-built grand vision.
- **Make the SDK matter.** If your project would work identically without
  `vellar-sdk`, you'll lose 25 points on criterion 1.
- **Test the golden path on testnet** before recording your demo, judges
  will try to use it.
- **Handle transactions correctly.** `vellar-sdk`'s `.pay()` and
  `wallet.policies.deploy()` already simulate before signing, don't bypass
  that if you drop to the lower-level building blocks.
- **Write the README for a stranger.** Judges should be able to run your
  project from the README alone.
- **Keep the demo video focused.** Show the core flow working. Skip the long
  intro.

---

## Questions

Ask in [Telegram](https://t.me/+JvRMWLJMWS0xYTBk), that's the live support
channel for the whole weekend. For SDK questions, start with
[Quickstart](./quickstart.md), [Wallet Methods](./wallet-methods.md), and
[Security](./security.md).

*Build fast. Build honest. Good luck.*
