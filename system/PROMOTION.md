# Promotion checklist

This checklist is for maintainers. Use it whenever something proven in a
private Home Base, or in another private project, is brought into this public
repository. It keeps private information out of public files, commits, and pull
requests by structure and routine, not by memory.

## 1. Classify the work

Sort every piece into one of two lanes before you write anything:

- **Lane A — stays private.** Anything that only makes sense with the owner’s
  real data, accounts, people, money, health, or private setup. This includes
  denylists, private configuration, real sample data, screenshots of real
  screens, and anything under `instance/`. Lane A never moves. Sample data is
  never modeled on the owner’s own routines, programs, or targets, even with
  the numbers changed: invent something plainly generic instead.
- **Lane B — generic.** The reusable idea: a workflow, a safety rule, a
  validator check, an interface pattern, a script that works for anyone.

If a piece mixes both, split it. Only the generic part continues.

## 2. Author fresh on a public branch

- Create a new local branch in this repository from a commit that already has
  `system/privacy-scan.mjs` (the installed hook refuses to push a branch that
  does not).
- Write the Lane B piece again from scratch. Never copy private files, never
  cherry-pick or merge private history, and never paste private commit
  messages.
- Use invented sample data only, clearly labeled as fictional. Never adapt a
  real record by changing a few details.
- Set a commit author email that is safe to publish (a GitHub `noreply`
  address is recommended). Annotated tags record the same identity as the
  tagger, so set it before tagging too.

## 3. Scan with the private denylist

Keep your denylist outside the repository: one private term per line. Cover
every private area, not only money and people: names, places, account
nicknames, employers, health or fitness programs and routines, clinics and
medications, schools, pets, and project or client code names. Prefer single distinctive words, such
as a surname or a street name, over full phrases: a phrase written another way
(“Surname, Given”, an initial) would not match it. The scan refuses a denylist
stored inside the repository.

Install the pre-push hook once per clone, so every push is scanned:

```bash
node system/privacy-scan.mjs --install-hook
export HOME_BASE_PRIVATE_DENYLIST=/path/outside/the/repository/denylist.txt
```

The installer copies `system/hooks/pre-push` into the clone’s own
`.git/hooks` folder, outside the tracked tree, so it runs for every branch,
including one cut from an older commit. Never set `core.hooksPath` to a folder
inside the repository: Git would then run whatever hook the checked-out branch
carries, or none. The installer refuses while `core.hooksPath` is set, and it
never replaces a different hook. Reinstall after `system/hooks/pre-push`
changes.

For each pushed branch or tag the hook runs the scanner committed on that
branch or tag, and refuses the push when:

- `HOME_BASE_PRIVATE_DENYLIST` is unset, or the file is missing or empty;
- `node` is not installed;
- the branch or tag being pushed has no scanner;
- the scan reports anything, fails, or crashes.

It scans every commit the remote being pushed to does not already have (names,
emails, messages, added files and their paths), annotated tag objects (tagger
and message), and the branch and tag names. Only history already on that
remote is skipped, never history from another remote.

Before asking for review, also run the scan yourself on everything that will
become public:

```bash
node system/privacy-scan.mjs --denylist "$HOME_BASE_PRIVATE_DENYLIST"
node system/privacy-scan.mjs --commits main..HEAD --denylist "$HOME_BASE_PRIVATE_DENYLIST"
node system/privacy-scan.mjs --tag v<version> --denylist "$HOME_BASE_PRIVATE_DENYLIST"
node system/privacy-scan.mjs --archive /path/to/home-base-<version>.tgz --denylist "$HOME_BASE_PRIVATE_DENYLIST"
node system/privacy-scan.mjs --text /path/to/pull-request-body.md --denylist "$HOME_BASE_PRIVATE_DENYLIST"
```

The scan checks email addresses, phone numbers, card-like numbers, last-four
phrasing, absolute machine paths, your local account name, and your denylist
terms, also after undoing fullwidth characters, `%40`-style and `&#64;`-style
encoding. In commits and archives it also flags private paths: anything under
`instance/` (any letter case) or `.home-base/`, `.env` files, `.key`, `.pem`
and `.p12` files, `CLAUDE.local.md`, and `.claude/settings.local.json`.
`--archive` extracts the package with the system `tar` into a private
temporary folder, scans every entry, and removes the folder.

Files that cannot be read as text (archives, compressed files, office
documents, PDFs, images, other binary data) are reported as `unscannable`.
UTF-16 text is decoded and scanned. If such a file must ship, review it
yourself, then list its exact path and sha256 under `unscannableFiles` in
`system/privacy-allowlist.json`; any change to the file needs a new review.

The scan prints only the rule and the location, never the matched text, so its
output is safe to share. A file name that itself matches is shown as
`[redacted path <label>]`; the label changes on every run, so it cannot be
checked against guessed names. Open each location yourself. Fix the content
rather than adding to `system/privacy-allowlist.json`; that file is only for
facts that are already public, such as the license holder’s name in `LICENSE`,
and each fact is allowed only in the files listed with it. Commit and push
scans read the allowlist as committed, never an uncommitted edit, and every
change to it appears in the diff the owner reviews.

## 4. Run every test with sample data only

Run every proof command listed in [`RELEASE-NOTES.md`](../RELEASE-NOTES.md)
and `node system/package.mjs --output /absolute/path/home-base-<version>.tgz`.
Tests must use the fictional fixtures they create; never point a test at a real
Home Base or real data.

## 5. Independent reviewer pass

Ask a reviewer who did not write the change to read the diff, the commit
metadata, and the pull-request text for anything private or identifying. Scan
the reviewer’s written report with `--text` before it is shared.

## 6. Draft pull request

Push the branch only after the scan and the review pass. Open the pull request
as a draft. Branches and pull-request pages on a public repository are public
and persist, so nothing private may be pushed even temporarily.

## 7. The owner merges

Only the repository owner merges, after reading the final diff. Agents never
push `main`, merge, or tag a release.
