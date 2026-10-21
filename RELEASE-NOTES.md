# Home Base 1.2.0

Version `1.2.0` is the current public stable Home Base release. It is for
anyone who uses the local dashboard: you can now give it your own look, and
you can choose to open it on your phone through a locked copy on your own
Vercel account. Nothing goes online unless you ask, and your own files are
never changed by an update.

## Before you update

- **Node.js 20 or later**, as for 1.1.0. Nothing else is installed. Putting
  the dashboard online also downloads the official Vercel command-line tool
  through `npx` (part of Node.js), and only after you say yes.
- **Updating from 1.1.0.** Your 1.1.0 updater installs 1.2.0 as usual
  (preview, prepare, approve, apply). If your dashboard is running, stop it
  and start it again afterwards so it uses the new version.
- **Updating from 1.0.x.** Your 1.0.x updater can install 1.2.0 directly; you
  do not need 1.1.0 first. What the 1.1.0 notes below say for 1.0.x still
  applies: the 1.0.x preview of this update is cut off when an assistant
  reads it through a pipe, so save it to a file outside your Home Base first
  (`node system/update.mjs preview --candidate <new-release> > <outside>/preview.json`)
  or preview with the new release's updater
  (`node <new-release>/system/update.mjs preview --root <your Home Base> --candidate <new-release>`).
  Right after the update, your assistant asks before running
  `node system/update.mjs init` once, which deletes the old updater's
  leftover staging copy. If an update is stuck under 1.0.x, the repair in
  “Repair for an update stuck under 1.0.x” below works the same with the
  1.2.0 release.

## What is new

- **Make the dashboard yours.** Ask your assistant to restyle your dashboard
  in your own words, with or without a screenshot, or start from a preset
  (`precise`, `soft`, `night`, `calm`). Your look lives in
  `instance/dashboard/` (`theme.json`, and `theme.css` if you want more),
  which updates never touch. Colours that would be hard to read keep the
  default, and a theme the dashboard cannot use is skipped with a note at the
  bottom of the page. A look is made from colours, fonts already on your
  computer, and shapes; pictures and font files cannot be added, because the
  page loads nothing it was not built with. If you do nothing, the dashboard
  looks exactly as it did in 1.1.0. See “Make it yours” in
  [the dashboard guide](./system/dashboard/README.md).
- **Your dashboard on your phone (optional).** Say “put my dashboard online”
  and your assistant walks you through putting a copy of the dashboard's own
  view on your own free Vercel account, locked so only you can open it after
  signing in with Vercel. It is never public. You create the account and
  sign in yourself; your assistant never sees a Vercel password or token.
  Your assistant first asks which Vercel account or team to use and uses
  only the one you name, so a work team (whose members could open it) is
  never picked by accident. A harmless placeholder goes up first. Your copy
  is built only after `node system/dashboard/publish.mjs --check-locked`
  confirms that Vercel asks for a sign-in on every address; the tool itself
  refuses to build it without a passing check from the last 30 minutes.
  What goes online is the page, your theme, your private dashboard modules
  (their code and any data in their files), and the names and counts the
  dashboard already shows, never the Home Base folder. Every file is
  listed before upload, and links or anything that looks like a password,
  key, email address, phone or card number, or a folder path from your
  computer are refused. Say “update my online dashboard” after changes (each
  update asks you first), or “take it down” to delete it. See
  [Put the dashboard online](./system/workflows/put-the-dashboard-online.md).
- **Two new skills**, `style-home-base-dashboard` and
  `publish-home-base-dashboard`, so the release now has 42 repository Skills
  (15 Home Base core).

## For maintainers

- `node system/dashboard/test-publish.mjs` joins the proof commands and the
  Node 20 CI job. `smoke-browser.mjs` also renders a published copy and the
  `soft` preset in Chrome.
- `system/test-transition.mjs` now also installs 1.2.0 over a personalized
  1.1.0 (from tag `v1.1.0`) that holds a dashboard theme in `instance/`.

The notes for 1.1.0 follow exactly as they were released.

# Home Base 1.1.0

Version `1.1.0` is the current public stable Home Base release. It adds a
local dashboard and a private `instance/` folder, makes updates safer, and
fixes an updater bug in 1.0.x. Your own files are never changed by an update.

## Before you update

- **Node.js 20 or later.** Every command a user or assistant runs (checks,
  updates, the Capability Doctor, the dashboard) works on Node.js 20 or later
  and needs nothing else installed. To check, run `node --version`; `v20` or
  higher is enough, and the LTS installer is at nodejs.org. On an older Node,
  the updater and the dashboard say so in one sentence and change nothing.
  Maintainers who rebuild the dashboard need Node.js 22.13 or later.
- **Updating from 1.0.x.** Your current 1.0.x updater installs 1.1.0 as
  usual (preview, prepare, approve, apply). Its preview of this update (about
  265 KB) is cut off when an assistant reads it through a pipe, so save it to
  a file outside your Home Base first, for example
  `node system/update.mjs preview --candidate <new-release> > <outside>/preview.json`,
  or preview with the new release's updater:
  `node <new-release>/system/update.mjs preview --root <your Home Base> --candidate <new-release>`.
  Right after the update finishes, your assistant asks before running
  `node system/update.mjs init` once with the new release, which deletes the
  old updater's leftover staging copy.

## Repair for an update stuck under 1.0.x

The 1.0.x updater had a bug: its proof refused any Home Base that held your
own files. So a Home Base you had used could not finish an update. When the
update failed, the updater put your old files back, then ran that same proof
again, which failed, and the update stayed marked as unfinished. `node
system/update.mjs recover` then failed the same way ("Candidate contains
personalized files outside the starter manifest"). Your files were fine; only
the record of the unfinished update was stuck.

1.1.0's proof passes on a personalized Home Base, so this no longer happens.
If your Home Base is already stuck, extract the 1.1.0 release to its own
folder outside your Home Base and run its updater against your Home Base:

```bash
node <new-release>/system/update.mjs recover --root <your Home Base>
```

Use it only when `recover` fails with the message above. It first checks that
every maintained file matches either the copy saved just before the update or
the release you had installed. Then it clears the unfinished update and
restores nothing. It never writes your own folders or `instance/`. If any
maintained file was edited and matches neither, it lists those files and
changes nothing. If the 1.0.x updater was stopped while it was putting your
files back, so maintained files or folders (even `system/`) are missing, the
same command puts back only those maintained files from the saved copy,
checks every fingerprint, and then finishes. See
[the update guide](./system/UPDATE-GUIDE.md).

## What is new

- **Local dashboard.** `node system/dashboard/serve.mjs` shows a one-page view
  of your Home Base on your own computer only: setup progress and the next
  step, the assistants you have checked, and your life domains (with labeled,
  fictional samples until you add your own). It reads a few names, writes only
  its own settings file, and needs a private sign-in key that it prints when
  it starts. See [the dashboard guide](./system/dashboard/README.md).
- **A private `instance/` folder.** Put private tools, dashboard modules,
  private skills, and other files that are only yours in `instance/`. Updates,
  packages, and proofs never read, copy, or delete it, and Git ignores it.
  `node system/instance-skills.mjs` previews, and with your approval links,
  private skills from `instance/skills/` so your assistants can use them.
- **Safer updates.** Updates keep only a small, short-lived staging copy and
  delete it after every outcome. After a failed update, a recover, or a
  rollback, the restored files must match the saved checkpoint's SHA-256
  hashes. You can roll back more than one update in a row. If an update fails
  and its automatic restore also fails, the update is marked
  `recovery_required` and the error prints the exact `recover` command, which
  uses the copy of the updater kept with that update. Updates now also work on
  a Home Base you keep in your own Git repository. Images, notes with broken
  links, links, and other files in your own folders, or anywhere outside the
  maintained files (a stray screenshot, an editor's settings folder), never
  stop an update, rollback, or recovery: the validator lists them as notes,
  never follows a link, and applies its release rules to the maintained files
  only.
- **Which assistants work.** Codex and Claude Code are supported. Grok Build
  CLI was verified to read Home Base on 2026-10-15 in a read-only test; it
  uses the same files and needs no adapter folder. Other assistants are
  unverified.
- **Capability Doctor per assistant.** Codex, Claude Code, and Grok Build each
  get their own row, found through their `--version` commands, and receipts
  are dated. As in 1.0.1, when Codex is installed the doctor asks the Codex
  CLI for its installed plugin list (`codex plugin list --json`). Codex may
  contact its plugin catalog to answer; the doctor sends it no Home Base
  content. Sign-in is reported as not checked.
- **Complete command output.** Update previews and other command output used
  to be cut off at 64 KB (Node 20) or 128 KB (Node 22) when an assistant read
  them through a pipe; a real preview is about 265 KB. Output now always
  arrives whole.

## For maintainers

- Packages are built from committed Git files at `HEAD` only; ignored or
  untracked files inside maintained paths are excluded and counted.
- Proof copies hold maintained files and pristine starters only, never your
  files, `instance/`, `.home-base/`, or Git metadata.
- The release manifest declares `instance/` with an additive `instancePaths`
  field (still schema 2, so the 1.0.1 updater can install this release).
- `system/privacy-scan.mjs` scans trees, commit ranges, tags, archives, text,
  and branch names with redacted output, backed by a fail-closed pre-push hook
  and the [promotion checklist](./system/PROMOTION.md).
- The GitHub workflows run only in the public repository, so a Home Base
  kept in a user's own GitHub repository gets no maintainer CI runs.
- Fixes from 1.0.1: the duplicate step number in `AGENTS.md`; the first setup
  question is named `scope` in both `you/SETUP.md` and `start.md`; Git clones
  are told how to initialize updates.

## Home Base 1.0.1

Version `1.0.1` fixed the unauthenticated stable-channel keeper by sending
GitHub's JSON media type and API version headers to API endpoints while
retaining octet-stream retrieval for release assets. The public `v1.0.0` tag
and release remain immutable.

## Home Base 1.0 foundation

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
node system/validate.mjs --release
node system/prove.mjs
node system/test-capability-doctor.mjs
node system/test-safe-update.mjs
node system/test-release-retrieval.mjs
node system/test-tracked-files.mjs
node system/test-instance-skills.mjs
node system/test-privacy-scan.mjs
node system/inspect-runtime.mjs
node system/dashboard/build.mjs --check
node system/dashboard/test-dashboard.mjs
node system/dashboard/test-publish.mjs
```

Maintainers also run these from a development checkout with full Git history
and tags (they are not part of the package proof):

```bash
node system/privacy-scan.mjs
node system/test-transition.mjs
node system/dashboard/smoke-browser.mjs
```

After tagging the exact clean Home Base source commit `v1.2.0`, create and
re-extract the public archive with adjacent checksum and metadata receipts:

```bash
node system/package.mjs --public-release --output /tmp/home-base-1.2.0.tgz
```

The command refuses an uncommitted Home Base tree. Upload the archive and its
`.sha256` and `.json` receipts to the `v1.2.0` GitHub release; the stable
channel already points to that metadata.

## Durable safety boundary

The public release does not authorize external account connection, sends,
publishing, spending, deployment, or future update application. Home Base must
still preview those actions, prove exact authority, and obtain the user's
approval at the moment of action.
