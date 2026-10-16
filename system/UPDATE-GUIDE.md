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

## The private instance zone

One more top-level folder belongs only to the user:

- `instance/`

`instance/` is the user’s private overlay: their own configuration, private
dashboard modules, private skills, images, or tools with a `node_modules`
folder. Home Base never packages it, never plans or applies an update to it,
never copies it into staging, checkpoints, bases, or journals, and never
deletes it. A candidate release that contains `instance/` is refused. Git
ignores it in any letter case, so an ordinary `git add` skips it; a forced
add (`git add -f`) would not, and the maintainer privacy scan flags any
`instance/` path in a commit or package.

Release-tree rules (no media files, no symbolic links, the credential scan)
do not apply inside `instance/`. Still keep passwords, keys, and tokens out of
it; Home Base never stores secret values. Back it up with the rest of your
Home Base folder.

Private dashboard modules can live in `instance/dashboard/`; the local
dashboard loads them at runtime (see `system/dashboard/README.md`), and the
public build never reads them.

Private skills can live in `instance/skills/<name>/SKILL.md`. To make them
available in every project, `node system/instance-skills.mjs` previews links
into `~/.claude/skills` and `~/.agents/skills`. Writing into your home folder is
an outside action: the agent shows the preview and asks for your approval at
that moment before it runs the same command with `--apply`. `--remove`
previews removing only the links that point into this `instance/`, and
`--remove --apply` deletes them after the same approval. Names must be kebab-case and may
not reuse one of the 40 repository Skill names.

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

A Git clone has no `system/distribution/release.json`, because that receipt is
written when a release is packaged. Initialize a clean clone with its exact
commit and where it came from instead:

```bash
node system/update.mjs init \
  --source-commit "$(git rev-parse HEAD)" \
  --source-ref <branch-or-tag> \
  --source-repository <clone-url>
```

`--source-ref` defaults to `developer-checkout` and `--source-repository` to
`local-developer-checkout` when omitted. Initialize only a clean checkout so the
recorded base matches the commit. The clone URL is stored in update state,
plans, and receipts, so pass it without any user name, password, or token;
the updater refuses a URL that contains one.

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

Apply re-hashes every input, stages the result on the same filesystem, runs
`validate.mjs` and `prove.mjs` on the stage, creates and verifies a full
checkpoint, writes a durable recovery marker, then swaps each disjoint
maintained root through a write-ahead journal, then runs both again on the
live folder. Success history is appended only after the new state and
immutable base are durable. Both checks pass in a Home Base full of your own
files, including one you keep in Git: the proof builds its test copies from
release files and pristine starters only, and the validator applies the
release rules (no images or other media, no broken local links, no
password-shaped text, no source maps) to the maintained files only. In your
own folders it lists the same problems as notes, which are worth a look but
never stop an update, rollback, or recovery.

The stage holds only the new maintained roots plus a short-lived copy of the
user-owned folders, which validation needs. It never holds `instance/` or other
unmanaged folders. Staging is deleted after every outcome (committed, failed,
or restored), and the replaced maintained roots kept during the swap
(`journal-old`) are deleted once the outcome is final. If a process is killed
mid-update, the next `init`, `prepare`, `recover`, or `rollback` deletes any
leftover staging first. Checkpoints and bases hold maintained content only.

## Recovery and rollback

After interruption, recover before attempting another update:

```bash
node system/update.mjs recover
```

Pre-mutation work is safely aborted. Once mutation began, recovery verifies and
restores the transaction checkpoint. Tampered checkpoints are never trusted.
Recovery and retry are idempotent.

A restore counts as finished only when every restored maintained file matches
the checkpoint's recorded fingerprint (SHA-256 hash) exactly. After that, only
the restored release's `validate.mjs` runs. Its `prove.mjs` does not: the proof
in 1.0.x refuses any Home Base that holds your own files, which is why a used
1.0.x Home Base could not finish an update that failed.

If an update fails and the automatic restore also fails (for example, the
disk fills up, or the restored files do not pass validation), the transaction
is marked `recovery_required`, the recovery marker stays in place, and the
error prints the exact `recover` command to run. Nothing else can start until
recovery finishes.
Restore puts maintained folders back one at a time, `system/` first, and
builds each copy before swapping it in, so a failure part-way never leaves a
folder missing.

Each update and rollback also keeps a copy of the updater with its
transaction, and that copy is the one to run after `recovery_required`: the
release now in `system/` may be an older one the restore put back, or missing
if the computer stopped in the middle of swapping `system/`. The error and
`.home-base/state/recovery.json` (`recoverCommand`) give the exact command:

```bash
node .home-base/state/transactions/<transaction-id>/tool/system/update.mjs recover --root <home-base-folder>
```

Recovery works from the checkpoint’s own list of folders, so it does not need
a readable `system/release-manifest.json`. Updates never rename, delete, or
copy `instance/`, `.home-base/`, `.git`, or a user-owned folder, under any
spelling or letter case; a release manifest that names one is refused.

Rollback only the latest committed transaction using its exact id:

```bash
node system/update.mjs rollback \
  --transaction <transaction-id> \
  --approve <same-transaction-id>
```

Rollback is a stack. After the latest transaction is rolled back, the one
committed before it becomes the latest and can be rolled back the same way.
Rollback refuses a transaction that did not install the release that is current
now, so an out-of-date entry can never restore the wrong files.

Rollback itself writes a recovery marker, so an interrupted rollback can be
completed from the same checkpoint.

### An update stuck under 1.0.x

The 1.0.x updater has a bug. If an update fails after the swap, it puts your
old files back, then runs the old proof, which refuses any Home Base that
holds your own files. The update stays marked as unfinished, and
`node system/update.mjs recover` fails again with the same message
(“Candidate contains personalized files outside the starter manifest”). Your
files are fine; only the record of the unfinished update is stuck.

Repair it with the updater from the newer release you were installing (its
extracted folder, outside your Home Base):

```bash
node /path/to/new/home-base/system/update.mjs recover --root <home-base-folder>
```

It checks before it changes anything. Every maintained file must match either
the copy saved just before the update (the restore finished) or the installed
release as it was first set up (nothing was swapped). If so, it restores
nothing. It only clears the unfinished update, removes
`.home-base/state/recovery.json`, and deletes that update's staging copy, which
holds copies of your own files. It never writes your own folders or
`instance/`, so it adds no entry to `memory/UPDATE-HISTORY.md`.

If any maintained file matches neither, it lists those files, stops, and
changes nothing. This happens in two cases:

- **A file was edited after the failed update.** Move any edits you want to
  keep somewhere else, put the files back as they were, and run the same
  command again.
- **The 1.0.x updater was stopped while it was putting your files back** (for
  example, the computer shut down), so some files are still the newer
  release’s. Run the 1.0.x updater’s own recover once, from your Home Base
  folder: `node system/update.mjs recover`. It finishes copying the saved
  files back, then stops with the same “personalized files” message as
  before; that is expected. Then run the command above again, and it
  completes.

You can then update normally.

## Rollback across the instance boundary

Releases before 1.1 do not know about `instance/`. Their validator checks the
whole folder, your own folders included, and rejects symbolic links, images
and other media, broken local links, and password-shaped text anywhere. So it
fails on a populated `instance/`, and on such files in your own folders.
Moving back to 1.0.x therefore needs one extra step, called parking:

1. Move `instance/` out of the Home Base folder to a sibling folder on the same
   disk, for example `<home-base-folder>-instance-parked`.
2. Run `node system/validate.mjs`. Every file it lists under “Notes about your
   own files” would stop the 1.0.x validator. Move those files out too, to a
   sibling folder such as `<home-base-folder>-files-parked`, keeping their
   folder names.
3. Run the rollback above, once per transaction, until the 1.0.x release is
   current again.
4. Leave everything parked while you are on 1.0.x.
5. After updating to 1.1 or later again, move it all back and run
   `node system/validate.mjs`.

If a rollback to 1.0.x was started without parking, it stops with
`recovery_required` (the 1.0.x files are back, but validation failed). Park
`instance/`, then run the `recover` command the error printed (also saved as
`recoverCommand` in `.home-base/state/recovery.json`). Do not use the 1.0.x
`node system/update.mjs recover` for this: on a Home Base that holds your own
files, its proof refuses to finish.

The first update from 1.0.x to 1.1 is run by the 1.0.x updater, which copies the
whole folder into staging. Do it while `instance/` is parked or holds plain text
only. Right after it commits, the agent asks for your go-ahead and runs
`node system/update.mjs init` once with the new release, so the new updater
deletes that old staging copy (it would otherwise stay until the next update).

The 1.0.x updater's preview is cut off at 64 KB (Node 20) or 128 KB (Node 22)
when an assistant reads it through a pipe, and the preview of this update is
larger. Save it to a file outside the Home Base folder and read the file:

```bash
node system/update.mjs preview --candidate /path/to/new/home-base > /path/outside/preview.json
```

The new release's updater gives the same read-only preview, complete:
`node /path/to/new/home-base/system/update.mjs preview --root <home-base-folder> --candidate /path/to/new/home-base`.
Prepare and apply still run with the installed 1.0.x updater as usual.

Home Base must never invent a download URL, run `git pull`, or fetch a mutable
branch as an update. `system/retrieve-release.mjs` may inspect the public stable
discovery pointer, but it downloads only an immutable tag-bound GitHub release
asset with a full commit, declared byte size, and SHA-256. It permits
only the exact `MattEspo23/home-base` GitHub trust root, bounded redirects,
bytes, and time. It hashes before extraction, preflights every tar header in
temporary storage, and rejects traversal, path collisions, links, devices,
special files, excess entries, and excess uncompressed size. The verified
candidate must live outside the installed Home Base tree and still goes through
preview, prepare, exact approval, apply, proof, recovery, and rollback.
