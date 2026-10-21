# Put the dashboard online

Use this workflow when the user wants their dashboard on their phone and
computer, always on: “put my dashboard online,” “I want it on my phone,”
“update my online dashboard,” or “take it down.”

The dashboard stays on this computer by default. Online is optional, uses the
user’s own free Vercel account, and is locked so only they can open it after
signing in with Vercel. It is never public.

## What goes online

Only the dashboard’s own view, never the Home Base folder: the page, its
look (`instance/dashboard/theme.json`, `theme.css`), declared private
modules (their `.js`, `.css`, and `.json` files), and `status.json`, the
names and counts the dashboard already shows. `node
system/dashboard/publish.mjs` lists every file before anything is uploaded
and refuses links, other files in a module folder, and text that looks like
a password, key, email address, phone or card number, or a folder path from
this computer. Module files go online too, their code and any data in their
`.json` files, so mention that once if the user has modules.

Putting the dashboard online is an outside action. Follow
`system/SAFETY.md`, and before the first upload give the user the Build Mode
preview from `system/workflows/enter-build-mode.md` (the account and team,
what goes online, who could open it, how to take it down).

## One-time setup

Say it plainly, then do it one step at a time:

1. **A free Vercel account.** The user creates it themselves at
   vercel.com/signup. The free Hobby plan is for personal, non-commercial use.
2. **Sign in once on this computer.** The user runs
   `npx --yes vercel@62.1.0 login` in their own Terminal window and finishes
   in the browser. Before the first `npx`, ask: it downloads the official
   Vercel command-line tool (`vercel@62.1.0`, about 10 MB plus its
   dependencies) from npm. You never ask for, read, print, or store a Vercel
   token or the CLI’s sign-in files.
3. **Confirm where it goes.** A Vercel sign-in can belong to more than one
   team, for example a work team as well as the user’s own Hobby account,
   and the CLI may pick a work team by default. Everyone on a team can open
   that team’s locked projects, so a work team would show the user’s
   Home Base to colleagues. Run `npx --yes vercel@62.1.0 whoami` and
   `npx --yes vercel@62.1.0 teams list`, show the user the account and the
   teams, and ask which one to use. Use only a team or account the user
   names (normally their own Hobby account); if they are unsure, stop and
   let them check at vercel.com. Its short name (slug), as `teams list`
   shows it, is `<scope>`: pass `--scope <scope>` to every `vercel` command
   below, every time, and never rely on the CLI’s default.
4. **The folder.** Use a new folder outside Home Base named
   `home-base-dashboard`, next to the Home Base folder unless the user picks
   another place. Its name becomes the project name.
5. **The lock, before anything private goes up.** Ask before each upload and
   before changing the Vercel project.
   1. Upload the harmless placeholder:
      `node system/dashboard/publish.mjs --placeholder --out <folder>`, then
      `npx --yes vercel@62.1.0 deploy --cwd <folder> --prod --yes --scope <scope>`.
      The first upload creates the project in that team or account. The
      deployment address it prints ends in `-<scope>.vercel.app`, with the
      slug exactly as `teams list` showed it; if it does
      not, stop and look at the project at vercel.com with the user. Note
      the production address it shows (for example
      `https://<project>.vercel.app`) and the deployment address on its last
      line. Always use the addresses it printed, never one you guess: a
      `.vercel.app` name may belong to someone else.
   2. Turn on the lock. Either the user does it at vercel.com: open the
      project, Settings, Deployment Protection, turn on Vercel
      Authentication, choose **All Deployments**, Save. Or, with their yes,
      you run
      `printf '%s' '{"ssoProtection":{"deploymentType":"all"}}' | npx --yes vercel@62.1.0 api '/v9/projects/home-base-dashboard?slug=<scope>' -X PATCH --input - --silent --scope <scope>`.
      (Use the project’s own name if the folder has another name; `slug`
      names the same team or account so the change cannot land elsewhere.) It uses
      the CLI’s own sign-in, and `--silent` keeps the project’s
      settings, which can hold secrets, out of the chat. The default,
      Standard Protection, leaves the production address open, so it is not
      enough.
   3. Check it: `node system/dashboard/publish.mjs --check-locked
      <production address> <deployment address> --out <folder>`. It asks
      for the page, the data, and a script without any sign-in and passes
      only if Vercel asks for a sign-in every time. A pass is noted in the
      folder; the real copy can be built there only in the next 30 minutes,
      and only once per pass.
   4. Only then build the real copy:
      `node system/dashboard/publish.mjs --out <folder>`. Show the user the
      “These files will go online” list, then upload with the same deploy
      command.
   5. Check again with the production address and the new deployment
      address (`--check-locked … --out <folder>`).

If a check fails at any point, stop. Put the placeholder back at once
(`--placeholder --out <folder>`, then deploy `--prod`), tell the user what
the check said, and ask before removing an exposed deployment with
`npx --yes vercel@62.1.0 remove <deployment address> --scope <scope>`. Fix the lock and check
again before trying the real copy.

## On the phone

Open the production address in the phone’s browser, sign in with Vercel, and
add it to the home screen (Safari: Share, Add to Home Screen; Chrome: menu,
Add to Home screen).

## Keeping it fresh

There are two ways. Asking each time is the default; automatic updates are
only for a user who asks for them. Hobby allows 100 uploads a day.

**Asking each time.** After changes, the user says “update my online
dashboard.” Run `--check-locked <production address> --out <folder>` first,
then `--out <folder>`, show the list, and with the user’s yes deploy
`--prod --scope <scope>` (the same team or account as before). Then check the
production and new deployment addresses again. At the end of a session where
Home Base changed, you may offer once to do this.

**Automatic updates (only if the user asks).** If the user explicitly asks
for automatic updates (for example “update my online dashboard automatically
at the end of each session where Home Base changed”), confirm it in one
sentence and record it in `you/PREFERENCES.md` under a “Standing approvals” heading:
their exact words, the date, the project name, the production address, and
`<scope>`. That standing yes covers only putting a new copy of the dashboard’s
own view on that same, already-locked project in that same team or account.
Nothing else: not a new project, team, or account, not the lock settings, and
not taking it down. The user can stop it any time by saying so; then remove
the note.

When it is on, at the end of each session where Home Base changed:

1. `node system/dashboard/publish.mjs --check-locked <production address> --out <folder>`.
   If it does not pass, upload nothing: put the placeholder back (see above),
   tell the user what the check said, and ask.
2. `node system/dashboard/publish.mjs --out <folder> --auto`. It refuses the
   first upload and any file the last upload did not have (a new module or a
   new file). If it refuses, upload nothing: show the user the list and ask,
   as in “Asking each time.”
3. Deploy with the same command and `--scope <scope>`, without asking.
4. Check again: `--check-locked <production address> <new deployment address>
   --out <folder>`. If it fails, put the placeholder back at once, tell the
   user, and ask.
5. Tell the user in one line that the online copy was updated, or why not.

## Never

- Upload anything from Home Base before `--check-locked` passes on that
  project, or make it public.
- Update automatically unless the user asked for it and it is recorded in
  `you/PREFERENCES.md`, or without `--auto`.
- Upload to, or change a project in, a team or account the user did not name,
  or run a `vercel` command without `--scope <scope>`.
- Turn Vercel Authentication off, or choose Standard Protection: either one
  opens the copies already uploaded.
- Create a Shareable Link, a protection bypass secret, or a Deployment
  Protection Exception; approve another person’s access request; deploy with
  `--public`; or run `vercel curl`, which creates a bypass secret by itself.
- Read or print `vercel project protection`, project settings, tokens, or the
  CLI’s sign-in files.

## Taking it down

With the user’s yes,
`npx --yes vercel@62.1.0 remove home-base-dashboard --scope <scope>` deletes the whole project and every copy. They can also delete it at
vercel.com (project, Settings, Delete Project). The local folder can then go.
