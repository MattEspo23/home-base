# Local dashboard

A one-page view of your Home Base: setup progress and the next step, the
assistants you have checked, and your life domains. It runs only on your
computer. It reads a few names from your Home Base folder and writes only its
own settings file, `.home-base/state/dashboard.json`.

## Start it

It needs Node.js 20 or later and nothing else. From the Home Base folder:

```sh
node system/dashboard/serve.mjs
```

It prints an address like `http://127.0.0.1:<port>/#key=…`. Open that exact
address, including the part after `#`. Your browser trades the key for a
sign-in that lasts about a year, and the key disappears from the address bar.
After that, `http://127.0.0.1:<port>/` opens the dashboard directly in that
browser. Use `127.0.0.1`, not `localhost`: they are different addresses to a
browser.

Lost the address? Run the same command again. If the dashboard is already
running, it prints the address again and exits.

Press Ctrl+C to stop it, or close the Terminal window it runs in.

Other options:

- `--home-base <folder>`: show another Home Base folder. The folder must
  contain `AGENTS.md` and `you/SETUP.md`; anything else is refused before
  anything is written.
- `--port <port>`: use a different port, for example when another program
  already uses this one. The choice is saved for next time. A new port starts
  with empty browser storage for the dashboard, because browsers keep storage
  per address.
- `--new-key`: make a new key, for example if you shared the address by
  mistake. Browsers signed in before must open the new address.
- Add `?samples=off` to the address to hide the sample previews.

## Ports

The port belongs to this Home Base folder. It is picked at first launch from
20000 to 39999 and saved in `.home-base/state/dashboard.json`, so it stays the
same after updates, and a copied folder gets its own port and key. Ports 4173
and 5173 are never used. Two installs on one computer pick the same port only
rarely (about 1 in 20,000); if that happens the second one refuses to start,
and `--port` fixes it.

Before it starts, the launcher checks whether anything already answers on
the port, including programs listening on every address. If something does,
it stops and suggests a free port instead of sharing or silently changing it.

## For assistants

When the user asks to open the dashboard:

1. Ask before starting it. Say that it runs a small local web server on this
   computer until it is stopped.
2. Start `node system/dashboard/serve.mjs` in the background (it does not
   exit on its own) and wait for the line starting `Open this address`.
3. Give the user the exact `http://127.0.0.1:<port>/#key=…` address it
   printed, once. Never rewrite it as `localhost`, and never shorten the key.
   The key is this computer’s own dashboard sign-in, not an account
   credential, and it works only on `127.0.0.1`, so Home Base’s rule against
   repeating credentials does not stop you from handing it over (see the
   exception in `system/SAFETY.md`). If the user asks, you may open that
   exact address in a browser on this computer, including when they paste it
   back. Never write it into any file, memory, note, or index.
4. Tell them how to stop it: ask you to stop it (end the process you
   started), or press Ctrl+C in its Terminal window.

If the launcher says permission was denied, your sandbox does not allow local
servers. Ask the user to run the command in their own Terminal window from the
Home Base folder. Exit codes: 0 already running (address printed again),
2 refused before starting, 3 port in use, 4 permission denied.

## What it reads

- From `you/SETUP.md`: setup status, stage, discovery path, completed count,
  and the next question id, each checked against known values.
- From `projects/INDEX.md`, `systems/INDEX.md`, `capabilities/INDEX.md`, and
  `skills/INDEX.md`: the names of linked list items only, in the line format
  defined under Index entries in `system/WORKSPACE-CONTRACT.md`. A name
  longer than 80 characters is shortened and ends with “…”. Assistants
  come from capability lines such as
  `- [Codex opens Home Base directly](codex.md) — reads AGENTS.md; checked 2026-10-12`.
  An assistant shows as verified only when its line has a real calendar date.
  A long line may wrap onto indented lines; the date is still found there,
  and the wrapped text is never shown.
  Entries without a local link are counted, never shown: the page says
  “N more entries not shown — add a link to show them.”
- Whether `AGENTS.md`, `CLAUDE.md`, `.agents/skills`, and `.claude/skills`
  exist, and how many repository skills they hold.

- `instance/dashboard/theme.json` and `theme.css`, if present (see “Make it
  yours”).

It never returns file bodies or unlinked text, and it never reads through a
symbolic or hard link or outside the Home Base folder.

## Safety rules

- The server answers only `GET` requests sent to the exact address
  `127.0.0.1:<port>`, sends no CORS headers, and refuses cross-site requests.
- Every route needs this install's sign-in cookie, except a small help page
  that holds no data and no key. The cookie is `HttpOnly` and
  `SameSite=Strict`. It has no `Secure` flag: that flag needs HTTPS, Safari
  refuses it on `http://127.0.0.1`, and the connection never leaves this
  computer, so there is no network to protect. Its name carries the port,
  because browsers share cookies across all ports of `127.0.0.1`: the browser
  also sends it to any other local server you open on `127.0.0.1`, whatever
  its port. Such a server is a program running as you, which could read the
  settings file anyway. `HttpOnly` keeps the cookie away from scripts on
  those pages, and `SameSite=Strict` keeps other sites from using it.
- The key travels after `#` in the address. Browsers never send that part to
  any server or in a Referer, so it stays out of request logs. The settings
  file that holds it is readable only by you (mode 0600). Another account on
  this computer cannot use the dashboard without it. Programs running as you
  can read the file, just as they can read your Home Base folder itself.
- The data endpoints also need a value that changes on every launch.
- Pages get a strict Content Security Policy and make no outside requests.
  The Finance and Daily habits previews use fictional sample numbers from a
  seeded generator.
- Browsers: current Chrome, Edge, Firefox, and Safari 16.4 or later. Older
  Safari does not send the request details the server checks, and the page
  says so.

## Make it yours

The dashboard ships with one plain look. Make yours look and work however you
like: open your assistant in your Home Base folder and say so in your own
words, with or without a screenshot. For example, “redesign my Home Base in
this style,” “calmer and rounder,” “use my brand colours,” or “add a card for
my reading list.” It confirms once, makes the change, and shows you a picture.
“Put it back” undoes it.

Your look lives in `instance/dashboard/`, which updates never touch. The
assistant uses the lightest place that does the job:

- `theme.json` for colours, fonts, corners, spacing, and light or dark;
- `theme.css`, your own stylesheet, for anything else visual;
- a private module (below) for new cards or pieces;
- the dashboard’s own code in `system/dashboard/` only when nothing else can
  do it. Updates keep that change too and ask how to combine it with theirs.

Presets to start from, in `system/dashboard/themes/`: `precise` (the default),
`soft` (warm and rounded), `night` (always dark), and `calm` (light, soft
greys, roomy). To save credits, the assistant changes small files, starts from
a preset when one is close, and rebuilds nothing unless the app itself changes.

Quiet safety nets:

- Text that would be hard to read keeps the default colour, and the footer
  says which.
- A `theme.json` the dashboard cannot use is skipped, and the footer says why.
- The page loads nothing from the internet because it shows private things,
  so it uses fonts already on your computer, and styles and images stay in
  your files.

### theme.json settings

- `schemaVersion`: `1`. `name`: shown in the footer.
- `colors`: for `light` and `dark`, any of `background`, `surface` (cards),
  `text`, `mutedText`, `accent`, `accentText`, `border`, `success`, `warning`,
  and `danger`, as hex like `#1d4ed8`.
- `font`: `system` (the default), `plain`, `rounded`, `serif`, `mono`, or
  `humanist`.
- `radius`: `none`, `small`, `medium`, or `large`. `density`: `compact`,
  `comfortable`, or `airy`. `shadow`: `none` or `soft`. `mode`: `auto`,
  `light`, or `dark`.

The file is read on every page load, so a change shows when you reload. Like
other instance files, a link, a folder, or a file over 16 KB is not used.
`theme.css` loads last and can change any token from `src/styles.css` (for
example `:root { --text-headline: 26px; }`) or any rule; it is your own code,
like a module.

To check a theme without opening your dashboard, run
`node system/dashboard/preview-theme.mjs` (or add `--preset calm` or
`--theme <file>`). It prints any problem and, when Chrome or Chromium is
installed, saves pictures of a fictional sample Home Base.

## Ways to open your dashboard

- **On this computer:** see “Start it” above. This is the default.
- **Online, on your phone and computer:** optional. Say “put my dashboard
  online.” Your assistant puts a copy of the dashboard’s own view (not your
  folder) on your own free Vercel account, locked so only you can open it
  after signing in with Vercel, and updates it when you ask. See
  [Put the dashboard online](../workflows/put-the-dashboard-online.md).

## Private modules

Your own modules live in `instance/dashboard/`, which updates and packages
never touch. List them in `instance/dashboard/modules.json` as
`{ "modules": [{ "id": "my-module", "title": "My module", "entry": "index.js" }] }`
and put the files in `instance/dashboard/modules/<id>/`. Only listed modules
are served, and only their `.js`, `.css`, and `.json` files. Each module
exports `mount(element, api)`, where `api` has `getStatus()` and a
per-install `dbName` for IndexedDB. Modules replace the sample previews under
Life domains.

Modules load side by side; one that fails, or does not finish within 8
seconds, shows “could not load” without holding up the others.

Trust: a module is your own code and runs with the page's full access. It can
read what the page reads, call the dashboard's data endpoints, use the
page's browser storage, and open other pages. The page's security policy
cannot contain that. Add only module code you wrote or have read and trust.

## Maintainers

Edit `src/`, then run `node system/dashboard/build.mjs` (Node 22.13 or later;
running the dashboard needs only Node 20) to rebuild the committed `dist/`
(plain TypeScript with Node’s built-in type stripping, no dependencies, no
source maps). It records the Node version and
fingerprints of every source and output in `dist/build-info.json`.
`build.mjs --check` fails when `dist/` does not match `src/`, and says which
Node version to rebuild with when the versions differ. CI uses that exact
version.

Every visual value in `src/styles.css` comes from the tokens at its top.
`lib/theme.mjs` holds the theme rules and the default colours, which a test
keeps equal to those tokens; `themes/precise.json` must stay the default look.

Tests: `node system/dashboard/test-dashboard.mjs` and
`node system/dashboard/test-publish.mjs` (the online copy and the lock check,
against local fixtures only). Browser check:
`node system/dashboard/smoke-browser.mjs` drives a local Chrome or Chromium,
if one is installed, through the sign-in and the page on a temporary
fixture, then renders that fixture's online copy from a local folder server;
without one it says so and skips.
