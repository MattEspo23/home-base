# Inspect current capabilities

Use the Capability Doctor when a task may depend on a workflow, local command,
plugin, connector, authentication state, or provider permission.

Run the read-only receipt:

```bash
node system/inspect-runtime.mjs
```

Use `--json` for the typed record or `--output capabilities/<name>.md` to save a
dated user-approved receipt.

The receipt starts with its `Checked:` date. It reports each assistant command
it looks for (Codex, Claude Code, Grok Build) as its own row, and whether the
Home Base files each one documents reading are present (file presence, not a
live load test). Plugin rows come only from Codex’s own plugin list and say so;
plugins and connectors inside Claude Code or Grok Build are not checked, so
never read a Codex plugin row as evidence about another assistant. Sign-in is
not checked for any assistant.

## Record it in the index

After saving a receipt, add or update its line in `capabilities/INDEX.md`
(Index entries in `system/WORKSPACE-CONTRACT.md`). The receipt lists one
ready-made linked line per record, already in that format and grouped by
section; copy the lines the user wants. Put exactly one linked line per record
under the section that matches the result: Available and verified, Available
but unverified, or Missing or blocked. Move an existing line when the state
changes, and move a replaced receipt's line to Superseded.

Include a line for the assistant you are running in. You are working inside
this Home Base folder, so that is direct evidence; record it as:

```markdown
- [<Assistant> opens Home Base directly](<receipt>.md) — <one line>; checked YYYY-MM-DD
```

Use the assistant's product name (for example Codex, Claude Code, or Grok Build), the link
to the saved receipt, and the real date of the check. Without a valid date the
dashboard shows the assistant as not verified yet. Other capabilities use
`- [<Capability>](<receipt>.md) — <one line>; checked YYYY-MM-DD`.

The doctor evaluates only each capability’s declared `all_of` and `any_of`
requirements. `not_applicable` is different from `absent`: a command-only
workflow does not fail because it lacks a connector, while a plugin-plus-
connector workflow does. Installed-but-disabled plugins, unconfigured
connectors, unknown/needed authentication, and unknown/insufficient permission
fail only where declared. Authentication never implies permission or authority
to act.

The live probe may read repository metadata, allowlisted command versions
(`git`, `gh`, `codex`, `claude`, `grok` with `--version`), and Codex’s
host-reported plugin metadata (`codex plugin list --json`). It must not start a
model session, read token/config contents, trigger login or OAuth, call
provider business data, change plugin/connector state, or test a write. Treat the receipt as current environment evidence, not timeless
correctness proof.

Explain the result, what it can read or change, the smallest sufficient access,
a manual or narrower alternative, the direct-login surface, safe test, and
disconnect path. Planning or availability does not authorize action. Follow
`system/workflows/enter-build-mode.md` before using a capability externally.
