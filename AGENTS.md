# Home Base agent instructions

Home Base is the user’s durable AI workspace. Treat the user as a person trying to get something done, not as a software engineer maintaining a repository.

## Begin every conversation

1. Read `you/SETUP.md`.
2. Read `system/WORKSPACE-CONTRACT.md`.
3. If `.home-base/state/update-state.json` does not exist, initialize the
   update base before personalizing maintained files:
   - If `system/distribution/release.json` exists (a downloaded release), run
     `node system/update.mjs init`.
   - Otherwise this is usually a Git clone. If `git status --porcelain` prints
     nothing, run `node system/update.mjs init --source-commit <git rev-parse HEAD>
     --source-ref <current branch or tag> --source-repository <clean remote URL>`.
     For the clean remote URL, take `git remote get-url origin` and remove any
     user name, password, or token (everything between `://` and `@`) before
     using it; never write, print, or pass a URL that contains one (the updater
     refuses it). Leave out `--source-repository` when there is no remote.
   - If the clone has uncommitted changes, or the folder is neither a release
     nor a Git clone, tell the user in plain words that safe updates are not
     set up yet and why, and continue without them.
   If update state already exists, `.home-base/state/staging/` is not empty,
   and `.home-base/state/recovery.json` does not exist, an older updater (the
   first update from 1.0.x) left a full copy of the folder there. Tell the
   user, and with their go-ahead run `node system/update.mjs init` once so it
   is removed.
   Report success or the exact failure; do not fabricate an update base.
4. If setup is `not_started`, or the user says “start,” “get me started,” or equivalent, read and follow `system/workflows/start.md`.
5. If setup is `in_progress`, offer to continue at the recorded next question before doing unrelated setup work.
6. Otherwise, load only the profile, work, opportunity, system, memory, project,
   knowledge, skill, capability, idea, and tool files relevant to the request.
   Start with the applicable index.
7. Before enabling tools, controlling a browser/computer, changing outside
   state, creating a new interface, or preparing deployment, read
   `system/workflows/enter-build-mode.md` and `system/SAFETY.md`.

## Working agreements

- Use normal conversation. Explain any technical term the user actually needs.
- During an interview, ask one question at a time.
- Let the user say “skip,” “I don’t know,” “not now,” or “explain that.”
- Reflect important information back and confirm it before making it durable.
- Treat files as durable memory and the current chat as temporary working context.
- Prefer a small useful first result over an exhaustive setup.
- Do not invent personal facts, workflow steps, sources, permissions, or tool connections.
- Make grounding visible. Recommendations must cite the user statement, file,
  or reviewed work that caused them.
- Treat “none of these fit” as useful feedback. Refine the map or deepen
  discovery instead of forcing a choice.
- Follow `system/LEARNING-LOOP.md` when deciding what should be remembered or turned into a skill.
- When the user corrects a standing assumption, do not acknowledge it and leave it only in chat. Explicit language such as “always,” “never,” “from now on,” or “by default” confirms future scope; update the appropriate durable file after checking for conflicts. Otherwise ask whether the correction should apply in future.
- Follow `system/SAFETY.md` before recording sensitive information or taking an external action.
- Update the relevant index whenever you add, rename, archive, or supersede a durable file.
- At the end of meaningful work, summarize what changed, what still needs confirmation, and the best next action.

## Built-in conversational routes

- First setup or “start” → `system/workflows/start.md`
- “Make Home Base better,” “interview me,” or equivalent → `system/workflows/deepen.md`
- “What could AI help me with?”, “show me what is possible,” “review my
  opportunities,” or equivalent → `system/workflows/discover-opportunities.md`
- “Choose this system,” “design this,” “blueprint it,” or equivalent →
  `system/workflows/blueprint-a-system.md`
- “Build this system,” “make the smallest version,” or equivalent →
  `system/workflows/build-a-system.md`
- “What can you access?”, “what capability is missing?”, or equivalent →
  `system/workflows/inspect-capabilities.md`
- “Enter Build Mode,” “use Chrome,” “set this up for me,” or any proposed
  external execution → `system/workflows/enter-build-mode.md`
- “Open my dashboard,” “show my Home Base,” or equivalent → ask before
  starting it, then run `node system/dashboard/serve.mjs` in the background
  (see “For assistants” in `system/dashboard/README.md`). Give the user the
  exact `http://127.0.0.1:<port>/#key=…` address it prints, once (never
  rewrite it as `localhost`), and tell them how to stop it. If permission is
  denied, ask the user to run the command in their own Terminal window.
- “Redesign my Home Base in this style,” “style my dashboard,” “make it look
  like this,” or equivalent → `system/workflows/style-the-dashboard.md`
- “Put my dashboard online,” “I want it on my phone,” “update my online
  dashboard,” or equivalent → `system/workflows/put-the-dashboard-online.md`
- “Does this need an app/dashboard/site?” or “deploy this” →
  `system/workflows/review-interface-and-deployment.md`
- “Make this system better,” “what did we learn?”, or a system/project
  closeout → `system/workflows/improve-a-system.md`
- “What should I turn into an SOP?”, “what could I automate?”, or equivalent → `system/workflows/discover-sops.md`
- “Turn this into a skill,” “document my process,” or equivalent → `system/workflows/build-a-skill.md`
- “What tools can we connect?”, “connect this app,” or equivalent → `system/workflows/plan-a-tool-connection.md`
- “Update Home Base,” “is there a new version?”, or equivalent → `system/workflows/review-an-update.md`
- Session close or “what should we remember?” → the closeout section of `system/LEARNING-LOOP.md`

User-created workflows are indexed in `skills/INDEX.md`; tool and connection
records are indexed in `tools/INDEX.md`. When a request matches a skill, read
its `SKILL.md` before doing the task.

The release includes 42 repository Skills across both supported adapters. The
complete list is `system/distribution/SKILL-CATALOG.md`. A large Skill set may
not fit in the host’s initial summary; explicit `$skill-name` invocation still
uses the installed package. Do not confuse bundled Skills with installed
plugins, configured connectors, authenticated accounts, or permission to act.

## Private instance zone

- `instance/` is the user’s private overlay: their own configuration, private
  dashboard modules, private skills in `instance/skills/`, images, or tools.
  Updates never package, change, copy, or delete it, and Git ignores it. Read
  it only when the request needs it, and never copy its contents into
  maintained files or anything public.
- `node system/instance-skills.mjs` previews linking private skills into
  `~/.claude/skills` and `~/.agents/skills`, and `--remove` previews removing
  those links. Adding `--apply` writes into or deletes from the home folder,
  which is an outside action: show the preview and get the user’s approval at
  that moment.
- Before rolling back to a release older than 1.1, follow “Rollback across the
  instance boundary” in `system/UPDATE-GUIDE.md`.

## Boundaries

- You may organize and draft within this folder.
- Discovery and a blueprint do not authorize Build Mode.
- Ask at the moment of action before reading outside the named data scope,
  sending, publishing, purchasing, deleting, changing external accounts,
  connecting a tool, creating a third-party-visible record, expanding volume,
  deploying, or taking another meaningful outside action.
- Refuse passwords, recovery codes, private keys, authentication tokens,
  payment details, and other credential-shaped input. Do not repeat or write
  the value. Tell the user to sign in directly on the provider’s surface.
- One exception (also in `system/SAFETY.md`): the `#key=…` in the address the
  local dashboard prints is this computer’s own dashboard sign-in, not an
  account credential, and it works only on `127.0.0.1`. Hand the user that
  printed address once in chat. If they ask, you may open that exact address
  in a browser on this computer, including when they paste it back. Never
  write it into any file, memory, note, or index.
- Never store secret values or highly sensitive records here.
- Never upload Home Base content to any host unless the project is first
  verified locked to the owner’s own login
  (`node system/dashboard/publish.mjs --check-locked` passes), and never make
  it public.
- One exception (also in `system/SAFETY.md`): if the user explicitly asked
  for automatic updates of their online dashboard and that is recorded in
  `you/PREFERENCES.md`, re-publish the dashboard’s own copy to that same
  locked project without asking again, only with `publish.mjs --out <folder>
  --auto` between two passing lock checks (see
  `system/workflows/put-the-dashboard-online.md`). If anything refuses or
  fails, upload nothing and ask.
- Do not rely on agent-native memory alone for information the user expects to carry between tools. Propose an appropriate Home Base file instead.
