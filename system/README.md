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
- `release-manifest.json` — maintained, user-owned, and starter package paths
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

Files under `you/`, `work/`, `opportunities/`, `systems/`, `capabilities/`,
`ideas/`, `memory/`, `knowledge/`, `projects/`, `skills/`, `tools/`, and
`inbox/` belong to the user. Maintained releases should avoid overwriting those
paths.
