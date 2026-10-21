# Included Skills

Home Base includes 42 editable repository Skills: 15 Home Base core workflows and 27 pinned Skill Vault packages. Codex may omit some names from its first context summary when the Skill list is large; that is a display-budget limit, not a missing package. Invoke any package explicitly as `$skill-name`.

| Skill | Layer | What it does | Explicit invocation |
|---|---|---|---|
| `ask-espo` | Skill Vault | Ask which skill or flow fits your situation. A router over the skills in this repo. | `$ask-espo` |
| `blueprint-home-base-system` | Home Base core | Turn a selected Home Base opportunity into a complete system blueprint when the user chooses an idea, asks to design it, or wants to know what must exist before building. | `$blueprint-home-base-system` |
| `build-home-base-skill` | Home Base core | Turn a real repeated task or SOP into a reviewable Home Base skill when the user asks to document a process, build a skill, or teach the agent a workflow. | `$build-home-base-skill` |
| `build-home-base-system` | Home Base core | Build and verify the smallest useful version of a confirmed Home Base system when the user asks to make, implement, or test the selected blueprint. | `$build-home-base-system` |
| `code-review` | Skill Vault | Review the changes since a fixed point (commit, branch, tag, or merge-base) along two axes — Standards (does the code follow this repo's documented coding standards?) and Spec (does the code match what the originating issue/spec asked for?). Runs both reviews in parallel sub-agents and reports them side by side. Use when the user wants to review a branch, a PR, work-in-progress changes, or asks to "review since X". | `$code-review` |
| `codebase-design` | Skill Vault | Shared vocabulary for designing deep modules. Use when the user wants to design or improve a module's interface, find deepening opportunities, decide where a seam goes, make code more testable or AI-navigable, or when another skill needs the deep-module vocabulary. | `$codebase-design` |
| `deepen-home-base` | Home Base core | Improve the user's Home Base through a short focused interview when they ask to be interviewed, add context, or make Home Base know them better. | `$deepen-home-base` |
| `diagnosing-bugs` | Skill Vault | Diagnosis loop for hard bugs and performance regressions. Use when the user says "diagnose"/"debug this", or reports something broken/throwing/failing/slow. | `$diagnosing-bugs` |
| `discover-home-base-opportunities` | Home Base core | Create or refine an evidence-linked AI Opportunity Map when the user asks what AI could help with, what systems are worth building, or says the current ideas do not fit. | `$discover-home-base-opportunities` |
| `discover-home-base-sops` | Home Base core | Help a beginner identify repeated work that may be worth documenting when they ask what to automate, delegate, standardize, or turn into an SOP or skill. | `$discover-home-base-sops` |
| `domain-modeling` | Skill Vault | Build and sharpen a project's domain model. Use when the user wants to pin down domain terminology or a ubiquitous language, record an architectural decision, or when another skill needs to maintain the domain model. | `$domain-modeling` |
| `enter-home-base-build-mode` | Home Base core | Create and approve a bounded Build Mode preview before Home Base enables tools, controls a browser or computer, changes outside state, creates an external interface, or deploys. | `$enter-home-base-build-mode` |
| `grill-me` | Skill Vault | A relentless interview to sharpen a plan or design. | `$grill-me` |
| `grill-with-docs` | Skill Vault | A relentless interview to sharpen a plan or design, which also creates docs (ADR's and glossary) as we go. | `$grill-with-docs` |
| `grilling` | Skill Vault | Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases. | `$grilling` |
| `handoff` | Skill Vault | Compact the current conversation into a handoff document for another agent to pick up. | `$handoff` |
| `implement` | Skill Vault | Implement a piece of work based on a spec or set of tickets. | `$implement` |
| `improve-codebase-architecture` | Skill Vault | Scan a codebase for deepening opportunities, present them as a visual HTML report, then grill through whichever one you pick. | `$improve-codebase-architecture` |
| `improve-home-base-system` | Home Base core | Review suggestions and prove a Home Base system improved when the user closes a session or project, asks what was learned, or wants a better next run. | `$improve-home-base-system` |
| `inspect-home-base-capabilities` | Home Base core | Inspect current runtime and provider capabilities when a Home Base system needs coding, browser control, computer control, a connector, database, scheduling, or hosting. | `$inspect-home-base-capabilities` |
| `plan-home-base-tool` | Home Base core | Create a minimal-access connection plan when the user asks what tools Home Base could use or wants to connect an application safely. | `$plan-home-base-tool` |
| `prototype` | Skill Vault | Build a throwaway prototype to answer a design question. Use when the user wants to sanity-check whether a state model or logic feels right, or explore what a UI should look like. | `$prototype` |
| `publish-home-base-dashboard` | Home Base core | Put the Home Base dashboard online on the user's own Vercel account, locked to their Vercel sign-in, so it opens on their phone and computer; also update it after changes or take it down. | `$publish-home-base-dashboard` |
| `research` | Skill Vault | Investigate a question against high-trust primary sources and capture the findings as a Markdown file in the repo. Use when the user wants a topic researched, docs or API facts gathered, or reading legwork delegated to a background agent. | `$research` |
| `resolving-merge-conflicts` | Skill Vault | Use when you need to resolve an in-progress git merge/rebase conflict. | `$resolving-merge-conflicts` |
| `review-home-base-interface` | Home Base core | Decide whether a Home Base system needs conversation, a checklist, form, local dashboard, website, application, or approved hosted deployment. | `$review-home-base-interface` |
| `review-home-base-update` | Home Base core | Preview and safely review a newer Home Base release when the user asks to update without losing personal context or user-created workflows. | `$review-home-base-update` |
| `semantic-tree` | Skill Vault | Turn a broad or tangled topic into a structured decision map that connects questions, evidence, assumptions, and next actions. Use when an idea feels larger than the first answer, several concerns are mixed together, or the user needs to see what actually changes the decision before choosing a direction. | `$semantic-tree` |
| `setup-espo-skills` | Skill Vault | Configure this repo for the engineering skills — set up its issue tracker, triage label vocabulary, and domain doc layout. Run once before first use of the other engineering skills. | `$setup-espo-skills` |
| `start-home-base` | Home Base core | Start or resume the beginner Home Base interview when the user says start, get me started, set this up, or continue my setup. | `$start-home-base` |
| `style-home-base-dashboard` | Home Base core | Redesign the local Home Base dashboard in whatever style the user asks for, from their words, a screenshot, brand colours, or a preset, using the lightest change that achieves it. | `$style-home-base-dashboard` |
| `tdd` | Skill Vault | Test-driven development. Use when the user wants to build features or fix bugs test-first, mentions "red-green-refactor", or wants integration tests. | `$tdd` |
| `teach` | Skill Vault | Teach the user a new skill or concept, within this workspace. | `$teach` |
| `to-questionnaire` | Skill Vault | Turn a decision you can't fully answer into a questionnaire for someone else to fill in. | `$to-questionnaire` |
| `to-spec` | Skill Vault | Turn the current conversation into a spec and publish it to the project issue tracker — no interview, just synthesis of what you've already discussed. | `$to-spec` |
| `to-tickets` | Skill Vault | Break a plan, spec, or the current conversation into a set of tracer-bullet tickets, each declaring its blocking edges, published to the configured tracker — edges as text in one file per ticket locally, or native blocking links on a real tracker. | `$to-tickets` |
| `triage` | Skill Vault | Move issues and external PRs through a state machine of triage roles — categorise, verify, grill if needed, and write agent-ready briefs. | `$triage` |
| `wait-what` | Skill Vault | Stop. That last message did not land — re-pitch it. | `$wait-what` |
| `wayfinder` | Skill Vault | Plan a huge chunk of work — more than one agent session can hold — as a shared map of decision tickets on your issue tracker, and resolve them one at a time until the way to the destination is clear. | `$wayfinder` |
| `wizard` | Skill Vault | Generate an interactive bash wizard that walks a human through steps only they can perform. Use when provisioning infrastructure, setting up credentials or CI secrets, walking an unfamiliar third-party dashboard, or running a one-off migration or cutover. Don't invoke this for steps the agent can perform itself. | `$wizard` |
| `writing-for-agents` | Skill Vault | Writing documents for agents. Use when creating or editing skills, or modifying AGENTS.md or CLAUDE.md. | `$writing-for-agents` |
| `youtube-action-plan` | Skill Vault | Turn a YouTube video, transcript, or reliable summary into a small application plan with evidence, actions, and a review point. Use when a user wants to apply a video's useful ideas, separate insight from entertainment, or convert passive notes into a bounded experiment. | `$youtube-action-plan` |

## Representative natural-language routes

- “Help me get started with Home Base” routes to `start-home-base`.
- “Which Skill should I use for this idea?” routes to `ask-espo`.
- “Turn this YouTube video into a small experiment” routes to `youtube-action-plan`.
- “Review my Home Base update without overwriting my changes” routes to `review-home-base-update`.

If natural-language routing is ambiguous, use the explicit invocation shown in the table. External apps, connectors, sign-in, and account permissions are capabilities, not bundled Skills; run the Capability Doctor before relying on them.
