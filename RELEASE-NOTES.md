# Home Base 1.0

Version `1.0.0` is the first public stable Home Base release.

## Distribution additions

- 13 Home Base core Skills plus all 27 packages from the reviewed Skill Vault
  `v0.1.3` release / `cf0df42008cdffa79556a35ef79b803d3b2f19d7`
- Identical Codex and Claude adapter projections with normalized-name collision
  checks, per-file hashes, projection digest, and preserved license/notice
- Generated 40-Skill catalog with explicit invocations and representative
  natural-language routes
- Typed Capability Doctor for repository workflows, local commands, plugins,
  connectors, authentication, permissions, action state, evidence confidence,
  and safe next steps
- One copied first-open instruction that lets the agent initialize the update
  base and begin setup without asking the user to operate the scripts
- Clean-commit packaging that embeds source identity, produces SHA-256 and JSON
  receipts, scans the staged and extracted trees, and reruns proof on the staged
  package
- Root MIT, byte-verbatim upstream MIT, exact package provenance, protected
  brand/identity boundaries, latest-stable best-effort support, private security
  routing, and structured sanitized issue intake

## Customization-preserving updater

The schema-v2 updater stores an immutable installed base outside maintained
paths and performs a three-way comparison with the local and incoming trees.
It preserves local-only edits, proposes upstream-only changes, deterministically
merges non-overlapping text edits, and creates a reviewed resolution bundle for
overlapping intent or topology.

Apply requires the exact prepared plan digest. Maintained-file deletion requires
a second exact digest approval. The engine rejects ownership expansion,
traversal, symlinks, hardlinks, special files, case/Unicode collisions, corrupt
bases, stale resolutions, TOCTOU changes, and concurrent applies. It stages and
validates first, verifies a complete checkpoint, writes a durable recovery
marker, journals managed-root swaps, creates the next base only after proof,
and records success only after commit. Interrupted apply and rollback paths are
idempotently recoverable; checkpoint tampering stops recovery.

## Existing Home Base experience

- One-folder Understand → Recommend → Build journey
- Five-to-eight-question personal, work/business, or combined orientation
- Evidence-linked Opportunity Map with choose, refine, and “none fit”
- Complete system blueprint and four honest execution shapes
- Explicit Build Mode before tools, browser/computer work, interfaces, outside
  changes, or deployment
- Direct-provider login; credential-shaped values are refused
- Scope, volume, third-party, worst-case, stop, undo, and remaining-access
  previews
- Conversation/no-interface and justified-interface decisions
- One-suggestion session budget, durable declines, and same-task two-run proof
- Synthetic Daily Follow-Up Brief with read-only intake, draft-only output,
  sends disabled, and a reversible local interface
- Pristine starter-source packaging that cannot copy personalized user files
  into another person’s archive

## Release proof commands

From the `home-base/` folder:

```bash
node system/validate.mjs
node system/prove.mjs
node system/test-capability-doctor.mjs
node system/test-safe-update.mjs
node system/test-release-retrieval.mjs
node system/inspect-runtime.mjs
```

After tagging the exact clean Home Base source commit `v1.0.0`, create and
re-extract the public archive with adjacent checksum and metadata receipts:

```bash
node system/package.mjs --public-release --output /tmp/home-base-1.0.0.tgz
```

The command refuses an uncommitted Home Base tree.

## Durable safety boundary

The public release does not authorize external account connection, sends,
publishing, spending, deployment, or future update application. Home Base must
still preview those actions, prove exact authority, and obtain the user's
approval at the moment of action.
