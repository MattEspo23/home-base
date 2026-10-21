# Home Base

Home Base is a folder that interviews you, remembers what matters, and helps
your AI design and build the right small system around your life and work.

You do not need to understand the folders before you begin.

## Start in three steps

1. Download the Home Base archive, verify the adjacent SHA-256 receipt, and
   extract the `home-base` folder somewhere you can find again.
2. Follow [SETUP-GUIDE.md](SETUP-GUIDE.md) to install Codex or Claude Code and
   open this entire folder. Home Base's local checks and updates need
   Node.js 20 or later; nothing else is installed.
3. Copy this one instruction into a new task:

> Open this entire Home Base folder, read `AGENTS.md`, initialize the safe update base if needed, and start my setup.

The agent will ask one question at a time. You can say “skip,” “I don’t know,” or “explain that” whenever you want.

That first conversation creates durable context and an evidence-linked
Opportunity Map. You can choose one idea, refine the map, or say none fit.

## What it builds

- `you/` — what matters about you, your goals, and how you like to work
- `work/` — business context, people, priorities, and current tools
- `opportunities/` — evidence-linked ideas worth building now or saving for later
- `systems/` — one complete blueprint, build, safety, proof, and learning record per chosen use case
- `capabilities/` — dated notes about what the current assistant and providers can actually do
- `ideas/` — optional suggestions, durable declines, and revisit evidence
- `projects/` — what you are trying to finish and the next useful action
- `memory/` — decisions, corrections, and patterns worth carrying forward
- `knowledge/` — trustworthy information and source notes
- `skills/` — repeatable ways of doing work
- `tools/` — tools you use and safe plans for possible connections
- `inbox/` — information that still needs to be sorted

The maintained Home Base instructions live in `system/`. Most people never need to edit that folder directly.

## Included Skill Vault

The release contains 41 editable repository Skills out of the box:

- 14 Home Base core workflows for setup, discovery, system design, Build Mode,
  capability review, updates, dashboard styling, and learning; and
- 27 packages pinned from the public
  [EspoAI Skill Vault](https://github.com/MattEspo23/skills) `v0.1.3` release
  at commit `cf0df42008cdffa79556a35ef79b803d3b2f19d7`.

Both `.agents/skills/` and `.claude/skills/` contain the same package set.
Every projected file is bound to `system/distribution/skill-vault.lock.json`,
and exact original/upstream licenses and provenance ship with the release. The
projection is regenerated from the immutable `v0.1.3` tag. See the complete
plain-language list and explicit `$skill-name` invocations in
[system/distribution/SKILL-CATALOG.md](system/distribution/SKILL-CATALOG.md).

Skills are instructions, not account access. Apps, plugins, connectors,
authentication, and permissions remain separate. Say **“Inspect my current
Home Base capabilities”** to run the read-only Capability Doctor before relying
on any external tool.

## What to say next

Try any of these:

- “Start.”
- “What do you know about me so far?”
- “Help me choose the most useful thing to work on.”
- “Show me what AI could help with across my life and work.”
- “None of these ideas fit. Help me revise the map.”
- “Blueprint this system.”
- “Build the smallest useful version.”
- “Show me the Build Mode preview.”
- “Does this need an interface, or is conversation enough?”
- “Run a learning review and prove the next result changed.”
- “I do this task all the time. Help me turn it into a skill.”
- “Help me find three things I repeat that might be worth turning into a skill.”
- “What tools could help with this, and what is the safest way to connect them?”
- “Ask me a few questions to make my Home Base better.”
- “Review this Home Base update without overwriting my information.”
- “Before we stop, is there anything from this conversation worth remembering?”

If you are not sure what an SOP or skill should be, read [SOP-STARTER.md](SOP-STARTER.md) or just ask Home Base to help you find one.

## Works with more than one agent

Supported assistants:

- Codex, through `AGENTS.md` and `.agents/skills/`
- Claude Code, through `CLAUDE.md` and `.claude/skills/`

Grok Build CLI was also verified to read Home Base on 2026-10-15, in a
read-only test. It reads the same `AGENTS.md`, `CLAUDE.md`, and Skill folders,
so it needs no adapter of its own. Other assistants are unverified: they may be
able to read the folder, but that is not part of the support contract. The
durable information is ordinary Markdown, so it is not trapped inside any one
model.

## Keep private things private

Do not paste passwords, API keys, recovery codes, private keys, authentication
tokens, payment details, medical records, or other highly sensitive
information into Home Base or chat. Sign in directly on the provider’s
surface. Home Base should refuse credential-shaped input without repeating or
saving it.

Read [START-HERE.md](START-HERE.md) for the plain-language walkthrough.

When you receive a future verified release, open Home Base and say:

> Review this Home Base update without overwriting my information.

The agent compares the immutable installed base, your current customized copy,
and the incoming release. Local-only edits stay; upstream-only changes can be
proposed; non-overlapping text edits are merged deterministically; overlapping
intent stops for a reviewed resolution. The exact
preview/prepare/approve/apply/recover/rollback process is documented in
[system/UPDATE-GUIDE.md](system/UPDATE-GUIDE.md). Replacing the whole folder is
not a safe update method.

The official `v1.1.0` GitHub release provides the current immutable Home Base archive,
adjacent SHA-256 receipt, and machine-readable release metadata. Use those
release assets rather than downloading a mutable branch snapshot.

Home Base is MIT-licensed for editing and reuse. Third-party provenance,
brand/identity boundaries, best-effort support, and private security guidance
are linked from [`NOTICE.md`](./NOTICE.md), [`SUPPORT.md`](./SUPPORT.md), and
[`SECURITY.md`](./SECURITY.md).

Maintainers and private testers can use the deterministic proof and packaging
commands in [RELEASE-NOTES.md](RELEASE-NOTES.md).
