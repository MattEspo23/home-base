# Safe Home Base updates

Home Base updates are explicit three-way transactions, not folder replacement.
The engine compares an immutable installed base, the current customized copy,
and an incoming verified release.

## Ownership boundary

Maintained release paths may change only through a reviewed transaction:

- `.agents/`
- `.claude/`
- `.github/`
- `.gitignore`
- `AGENTS.md`
- `BRAND-ASSETS.md`
- `CLAUDE.md`
- `channels/`
- `CODE_OF_CONDUCT.md`
- `CONTRIBUTING.md`
- `LICENSE`
- `NOTICE.md`
- `PROVENANCE.json`
- `README.md`
- `RELEASE-NOTES.md`
- `SECURITY.md`
- `SETUP-GUIDE.md`
- `SOP-STARTER.md`
- `START-HERE.md`
- `SUPPORT.md`
- `THIRD_PARTY_LICENSES/`
- `THIRD_PARTY_NOTICES.md`
- `TRADEMARKS.md`
- `VERSION.md`
- `system/`
- `templates/`

User-owned paths are never update targets:

- `capabilities/`
- `ideas/`
- `inbox/`
- `knowledge/`
- `memory/`
- `opportunities/`
- `projects/`
- `skills/`
- `systems/`
- `tools/`
- `work/`
- `you/`

New-release starter copies for those user-owned paths live under
`system/starter/`; they are packaging inputs, not permission to replace the
user’s files.

## What the comparison means

- **Upstream-only:** the local file still matches the installed base; propose
  the incoming version.
- **Local-only:** the incoming file still matches the base; preserve the local
  customization.
- **Non-overlapping text changes:** produce one deterministic proposed merge.
- **Overlapping intent or topology:** stop and create a transaction-bound
  resolution bundle containing base, local, and incoming evidence.
- **Deletion:** require the reviewed plan plus a second approval of that exact
  plan digest.

Paths are normalized and allowlisted. Symlinks, hardlinks, sockets, devices,
FIFOs, special files, case/Unicode collisions, ownership expansion, missing or
corrupt bases, stale resolutions, and changed-after-preview inputs fail closed.

## First-open initialization

An extracted release contains `system/distribution/release.json`. Before a
managed file is customized, initialize its immutable base:

```bash
node system/update.mjs init
```

Normal users can ask the agent to do this. Runtime state stays under
`.home-base/state/` and is excluded from packages.

## Review and prepare an update

First run a read-only preview:

```bash
node system/update.mjs preview --candidate /path/to/new/home-base
```

If the source, versions, hashes, changes, and rollback boundary are acceptable,
prepare a named transaction:

```bash
node system/update.mjs prepare --candidate /path/to/new/home-base
```

Preparation records a nonce, plan digest, release identities, every
base/local/incoming hash, conflicts, and deletions. It does not mutate current
managed files.

If conflicts exist, put only reviewed outputs under the printed
`resolution/output/` directory and seal them:

```bash
node system/update.mjs seal-resolution --plan /path/printed/plan.json
```

The seal binds exact output hashes and paths to the transaction nonce, plan
digest, and original inputs. An agent cannot add undeclared paths afterward.

## Apply the exact reviewed plan

Apply requires the printed digest as explicit approval:

```bash
node system/update.mjs apply \
  --candidate /path/to/new/home-base \
  --plan /path/printed/plan.json \
  --approve <exact-plan-digest>
```

For reviewed maintained-file deletions, also pass:

```bash
--approve-deletes <same-exact-plan-digest>
```

Apply re-hashes every input, stages the complete result on the same filesystem,
runs `validate.mjs` and `prove.mjs` on the stage, creates and verifies a full
checkpoint, writes a durable recovery marker, then swaps each disjoint
maintained root through a write-ahead journal. Success history is appended only
after the new state and immutable base are durable.

## Recovery and rollback

After interruption, recover before attempting another update:

```bash
node system/update.mjs recover
```

Pre-mutation work is safely aborted. Once mutation began, recovery verifies and
restores the transaction checkpoint. Tampered checkpoints are never trusted.
Recovery and retry are idempotent.

Rollback only the latest committed transaction using its exact id:

```bash
node system/update.mjs rollback \
  --transaction <transaction-id> \
  --approve <same-transaction-id>
```

Rollback itself writes a recovery marker, so an interrupted rollback can be
completed from the same checkpoint.

Until a separately approved public release exists, Home Base must not invent a
download URL, run `git pull`, fetch a mutable branch, or claim that “update” can
retrieve a public artifact. The current private release-candidate archive and
checksum support internal proof only.

When public release metadata exists, `system/retrieve-release.mjs` may inspect a
mutable discovery pointer, but it downloads only an immutable tag-bound GitHub
release asset with a full commit, declared byte size, and SHA-256. It permits
only the exact `MattEspo23/home-base` GitHub trust root, bounded redirects,
bytes, and time. It hashes before extraction, preflights every tar header in
temporary storage, and rejects traversal, path collisions, links, devices,
special files, excess entries, and excess uncompressed size. The verified
candidate must live outside the installed Home Base tree and still goes through
preview, prepare, exact approval, apply, proof, recovery, and rollback.
