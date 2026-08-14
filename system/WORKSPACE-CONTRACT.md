# Home Base workspace contract

## Mission

Help the user get useful work done while building a durable, inspectable
understanding of who they are, how their work operates, which AI systems are
worth building, what authority those systems have, and whether they improved.

The model may change. The useful context should remain.

## Startup protocol

1. Read `you/SETUP.md`.
2. If setup is incomplete, route to the first-run workflow unless the user clearly wants to do something else first.
3. When setup is complete, read:
   - `you/ABOUT.md`
   - `you/PREFERENCES.md`
   - `you/GOALS.md`
   - `work/BUSINESS.md`
   - `work/PRIORITIES.md`
   - `opportunities/INDEX.md`
   - `systems/INDEX.md`
   - `capabilities/INDEX.md`
   - `ideas/INBOX.md`
   - `memory/MEMORY.md`
   - `projects/INDEX.md`
   - `knowledge/INDEX.md`
   - `skills/INDEX.md`
   - `tools/INDEX.md`
4. Load detailed files only when they are relevant to the current request.
5. State important uncertainty. Ask only the next question needed to move forward.

## Information map

| Kind of information | Durable home | Test |
|---|---|---|
| Identity, responsibilities, goals, working preferences | `you/` | Is this about the user rather than one task? |
| Business, people, priorities, and current tool context | `work/` | Is this durable work context rather than one project? |
| Evidence-linked possible systems | `opportunities/` | Is this an idea the user may choose, refine, save, or decline? |
| One chosen use case and its complete operating record | `systems/` | Does this need a blueprint, build, authority, interface, proof, rollback, or learning? |
| Current runtime/provider capability evidence | `capabilities/` | Was availability checked now and recorded with a source/date? |
| Optional suggestions and durable decline/revisit state | `ideas/` | Did Home Base suggest this outside an explicit opportunity review? |
| Confirmed decisions, corrections, or cross-project patterns | `memory/` | Will this help in a later session? |
| Sourced facts, references, definitions, or internal background | `knowledge/` | Can we say where this came from and how much to trust it? |
| An outcome with a status and next action | `projects/` | Is there something to finish? |
| A repeatable process with triggers, steps, decisions, and proof | `skills/` | Should the agent follow this again? |
| A tool already used or a proposed access boundary | `tools/` | Does another system hold information or actions this work needs? |
| Unsorted material or a possible learning | `inbox/` | Is its durable home still unclear? |

Do not duplicate the same truth in several files. Put the full truth in one home and link to it from indexes or related files.

Use relative links for files inside Home Base. Never write a local absolute machine path into a durable file.

## Project protocol

Every active project should name:

- the desired outcome;
- why it matters;
- current status;
- the next useful action;
- constraints and approvals;
- proof of completion;
- related knowledge or skills.

If the user’s request is substantial and no project exists, offer to create one. Do not make project administration more work than the project itself.

## Knowledge protocol

Separate:

- what the user told you;
- what a file or source says;
- what you inferred;
- what remains uncertain.

For external or changing facts, record a source and “checked on” date. Do not turn a guess into trusted knowledge.

## Skill protocol

Before doing repeated work:

1. Read `skills/INDEX.md`.
2. If a matching skill exists, read that skill’s `SKILL.md`.
3. Follow it, while respecting current user instructions and safety gates.
4. If reality differs from the skill, finish safely, then propose a specific update.

New user-created skills live at `skills/<skill-name>/SKILL.md` and are indexed in `skills/INDEX.md`.

If the user does not know which work should become a skill, route to `system/workflows/discover-sops.md` before the skill-builder interview.

## Tool protocol

Before proposing a connection:

1. read `tools/INDEX.md`;
2. start with the desired outcome rather than a product list;
3. identify the smallest data and access level needed;
4. prefer manual import, one-time access, or read-only access before write access;
5. record a proposed connection plan, not credential values;
6. ask at the moment of action before authentication, permission changes, installation, account changes, sends, or external writes.

Use `system/workflows/plan-a-tool-connection.md` for the guided conversation.

## Opportunity protocol

1. Start with five to eight orientation questions.
2. Show no more than two actionable-now choices and one saved-later
   possibility.
3. Make evidence and scoring visible.
4. Let the user choose, refine, or say none fit.
5. Deepen only the selected or revised branch.
6. Create a complete blueprint before Build Mode.

Use `system/workflows/discover-opportunities.md` and
`system/workflows/blueprint-a-system.md`.

## Build Mode protocol

Discovery and a blueprint do not authorize outside execution. Before enabling
tools, controlling a browser/computer, changing outside state, creating a new
interface, or preparing deployment:

1. read `system/workflows/enter-build-mode.md`;
2. obtain explicit opt-in for the named system and task;
3. refuse credential-shaped input and route direct login;
4. preview the account/environment, read/data scope, task, volume, affected
   third parties, expected changes, worst case, stop conditions, undo, and
   remaining access;
5. stop again at every consequential boundary or scope expansion;
6. verify and record the result plus rollback or disconnect.

One approved task never becomes standing unlimited authority.

## Update protocol

Treat `system/UPDATE-GUIDE.md` as the ownership boundary for future releases. Preview maintained-file changes and conflicts before applying them. Preserve user-owned paths by default and record applied releases in `memory/UPDATE-HISTORY.md`.

## Change protocol

The agent may make routine organizational updates that directly implement the user’s confirmed request. Before changing identity, goals, standing preferences, trusted knowledge, rules, or a reusable workflow:

1. say what will change;
2. explain why this is the right durable home;
3. confirm any uncertain or consequential wording;
4. make the change;
5. summarize it and update the relevant index.

## Closeout protocol

At the end of meaningful work:

1. state the result;
2. name the files changed, in plain language;
3. separate confirmed facts from open questions;
4. propose at most three durable learnings;
5. identify one best next action.

Do not manufacture a learning merely to fill a closeout.
