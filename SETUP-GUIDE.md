# Install and open Home Base

This guide is for someone who has never used a coding agent. You do not need
to know how to code, use Git, or understand the folders.

Checked against the official setup pages on 2026-07-26. Apps, plans, and sign-in
steps can change, so use the linked provider page if your screen looks
different.

## Recommended: ChatGPT desktop with Codex

1. Install the current ChatGPT desktop app from
   [OpenAI’s official download page](https://chatgpt.com/download/).
2. Open the app and sign in to your own OpenAI account.
3. Open Codex in the app.
4. Choose this entire `home-base` folder, not an individual file.
5. Start a new task and paste:

> Open this entire Home Base folder, read `AGENTS.md`, initialize the safe update base if needed, and start my setup.

On an extracted release, the agent initializes `.home-base/state/` from the
verified installed files before you personalize them. That private runtime
state holds immutable update bases, reviewed plans, and rollback checkpoints;
it is not included in future packages.

OpenAI’s current
[desktop-app guide](https://help.openai.com/en/articles/20001276/)
explains the supported ChatGPT, Work, and Codex experience.

## Alternative: Claude Code

Claude Code also reads this folder’s built-in instructions. It is currently a
more technical setup than the desktop path above. Follow
[Anthropic’s official Claude Code setup guide](https://docs.anthropic.com/en/docs/claude-code/getting-started),
sign in through Anthropic’s own flow, open this entire folder, and type:

> Start

## Other assistants

Codex and Claude Code are the supported assistants. Grok Build CLI was also
verified to read Home Base on 2026-10-15, in a read-only test; it uses the same
files, so there is nothing extra to install in this folder. Other assistants
are unverified.

## What you do not need

You do not need to type Node.js commands for normal use. Codex or Claude can run
the included local validation, Capability Doctor, and update commands on your
behalf. If the doctor reports that the required local runtime is unavailable,
it should explain the smallest safe setup step rather than pretending the
feature works.

Those commands need Node.js 20 or later on your computer. Nothing else is
installed into this folder, and there are no extra packages to download.
(Maintainers who rebuild the dashboard need Node.js 22.13 or later; using
Home Base never does.)

To check, open Terminal (Command Prompt on Windows), type `node --version`, and
press Return. `v20` or a higher number is enough. If it says the command was
not found, or shows a lower number, install the LTS version from the official
site, [nodejs.org](https://nodejs.org/), then open a new Terminal window and
check again. Your assistant can also run this check for you.

Never paste a password, API key, recovery code, payment detail, or login token
into Home Base. When an account is eventually useful, sign in directly on the
provider’s page and approve only the exact action Home Base previews.

## If “Start” does nothing

- Confirm you opened the whole `home-base` folder.
- Start a new task or conversation from that folder and type only `Start`.
- If you opened a single Markdown file, close it and choose the folder instead.
- If the assistant did not load the project instructions, ask it to read
  `AGENTS.md` and then type `Start` again.
- If the app cannot sign in or cannot open Codex/Claude Code, use the provider’s
  official setup page above; account availability can change.

The first successful response should confirm that the update base is ready,
briefly explain Home Base, and ask whether you want to explore your personal
life, work/business, or both.
