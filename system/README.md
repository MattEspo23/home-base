# System

This directory contains the maintained Home Base behavior.

- `WORKSPACE-CONTRACT.md` — how the agent loads and uses Home Base
- `LEARNING-LOOP.md` — how useful observations become durable memory, knowledge, or skills
- `SAFETY.md` — privacy, confirmation, and external-action rules
- `UPDATE-GUIDE.md` — maintained-versus-user-owned update boundary
- `workflows/` — canonical Understand, Recommend, Build, and Improve behavior
- `examples/` — maintained synthetic reference systems and local proof assets
- `scenarios/` — clean-copy acceptance cases
- `starter/` — pristine sources used to materialize user-owned files in a
  release archive; never personalized during normal use
- `distribution/` — pinned Skill Vault lock, licenses, 40-Skill catalog,
  projection generator, and packaged release identity receipt
- `validate.mjs` — local structural checks
- `prove.mjs` — deterministic behavior and reference-system proof
- `inspect-runtime.mjs` — typed read-only Capability Doctor receipt
- `release-manifest.json` — maintained, user-owned, instance, and starter package paths
- `update.mjs` — initialize/preview/prepare/resolve/apply/recover/rollback
  three-way release transactions
- `package.mjs` — clean-commit private archive, checksum, identity, and
  extracted-copy proof builder
- `retrieve-release.mjs` — read-only GitHub channel discovery plus bounded,
  hash-first, preflighted extraction to a new directory outside Home Base
- `test-capability-doctor.mjs` and `test-safe-update.mjs` — deterministic state,
  conflict, attack, interruption, recovery, and rollback fixtures
- `test-release-retrieval.mjs` — redirect, identity, archive-topology, hash, and
  controlled-extraction fixtures
- `lib/tracked-files.mjs` and `test-tracked-files.mjs` — packaging reads only
  committed Git blobs, never ignored or untracked files
- `instance-skills.mjs` and `test-instance-skills.mjs` — preview-first linking
  of private skills from `instance/skills/` into the user-level skill folders
- `privacy-scan.mjs`, `privacy-allowlist.json`, `test-privacy-scan.mjs`, and
  `hooks/pre-push` — maintainer privacy scan with redacted output; the hook
  is installed into `.git/hooks` with `node system/privacy-scan.mjs --install-hook`
- `dashboard/` — the local, read-only Home Base dashboard: hardened
  `serve.mjs` launcher, `src/` built into the committed `dist/` by
  `build.mjs`, `test-dashboard.mjs`, and the optional `smoke-browser.mjs`
  (drives a local Chrome or Chromium when one is installed)
- `PROMOTION.md` — maintainer checklist for bringing private work into the
  public repository
- `test-transition.mjs` — maintainer-only 1.0.1 → 1.1 transition, instance, and
  rollback fixture (needs the Git history and tags; not part of the package proof)

Files under `you/`, `work/`, `opportunities/`, `systems/`, `capabilities/`,
`ideas/`, `memory/`, `knowledge/`, `projects/`, `skills/`, `tools/`, and
`inbox/` belong to the user. Maintained releases should avoid overwriting those
paths. `instance/` is the user’s private overlay; updates and packages never
include or touch it.
