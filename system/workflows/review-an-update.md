# Review a Home Base update

Use this workflow when the user has a newer Home Base release or asks to update
without losing customized context or managed Skills.

Read `VERSION.md`, `system/UPDATE-GUIDE.md`, `system/release-manifest.json`,
`system/distribution/skill-vault.lock.json`, and `memory/UPDATE-HISTORY.md`.

## Verify before comparing

Confirm the incoming artifact, adjacent SHA-256 receipt, release identity,
source commit, and Skill Vault pin. Do not invent a public URL, use a mutable
branch as a release, log in, download, pull, install, or apply merely because
the user asked whether an update exists.

The explicit request **“Review this Home Base update without overwriting my
information”** authorizes read-only discovery and a bounded verified download
from the exact public `MattEspo23/home-base` GitHub release trust root. It does
not authorize apply. If the user asks only whether an update exists, run
discovery and stop before download.

When no candidate folder was supplied:

1. Run `node system/retrieve-release.mjs discover --channel stable` (or
   `preview` only when the user explicitly asks for preview releases).
2. Show the resolved version, immutable tag, full commit, artifact filename,
   declared bytes, SHA-256, Skill Vault pin, and the fact that no signing system
   is claimed.
3. For an explicit review request, download to a new temporary directory
   outside the installed Home Base with
   `node system/retrieve-release.mjs download --channel <channel> --output <new-absolute-directory>`.
4. Treat retrieval failure, a closed channel, tag mismatch, redirect/host/size/
   timeout breach, hash mismatch, unsafe tar header, or proof failure as a clean
   stop. Never fall back to `main`, `latest`, `git pull`, or an arbitrary URL.

Retrieval hashes the full compressed asset before extraction, preflights every
archive header in bounded temporary storage, and then performs controlled
extraction. It must leave the installed tree byte-identical.

If a verified candidate folder is already available, run the read-only preview.
Explain current and candidate identities, user-owned protection, upstream-only
changes, local-only customizations, deterministic non-overlapping merges,
conflicts, deletions, validation, checkpoint, and rollback.

## Prepare without mutating current files

Only after the user wants a concrete apply plan, run `prepare`. If conflicts
exist, show the base/local/incoming evidence. Draft a resolution only for the
declared conflict roots, explain what it preserves from each side, and seal it
after review. A missing, foreign, changed, or incomplete resolution stops apply.

## Apply only the exact approval

Ask for approval of the printed plan digest as a whole. Ask separately for
deletions using the same digest. Then run apply with the exact candidate and
plan. Do not substitute a new candidate or regenerate the plan after approval.

The engine stages and validates first, re-hashes inputs, verifies a checkpoint,
writes a recovery marker, commits maintained roots, creates a new immutable
base, and records success only after durability. User-owned paths are never
eligible.

If interrupted, run `recover` before any new update. If the user later asks to
undo the latest committed update, preview the consequence and use the exact
transaction id for rollback approval.
