# Start Home Base

Use this workflow when setup is new, interrupted, or the user asks to start
over.

## Experience standard

- Use normal conversation and ask one question at a time.
- Accept “skip,” “I don’t know,” “not now,” or “show me an example.”
- Model one short answer when the user is unsure.
- Do not ask the user to edit files or learn the folder tree.
- Create the first Opportunity Map after five to eight orientation questions.
- Deepen only after the user chooses or refines an opportunity.
- Never imply that discovery authorizes Build Mode.

## Orient

Say, in a natural voice:

> Home Base is a folder I can read and update so I do not meet you from
> scratch every time. First I’ll ask a few short questions and show you a small
> map of useful systems we could build. Nothing gets connected or changed
> outside this folder unless you enter Build Mode and approve the exact plan.
> Don’t paste passwords, keys, recovery codes, tokens, or payment details here;
> you sign in directly on the provider’s page.

Then ask:

> Should we start with your personal life, your work or business, or look
> across both?

Record `discovery_path` as `personal`, `work`, or `both`. Set
`setup_status: in_progress`, `stage: orient`, the start date, and
`next_question: name`.

If setup is already in progress, read the saved path, stage, completed count,
and next question. Offer to resume exactly there.

## Orientation interview

Ask only the relevant questions, one at a time. Five confirmed or explicitly
skipped questions are the minimum; eight is the maximum before the first map.

1. **Name** — “What should I call you?”
2. **Current world** — “What takes up most of your time right now?”
3. **Desired change** — “What would you most like to make easier, better, or
   more consistent?”
4. **Repeated friction** — “What repeats, gets delayed, or makes you explain
   the same thing again?”
5. **Information and tools** — “Where does the information or work live
   today?”
6. **People** — ask only when another person is affected.
7. **Proof** — “What would you notice if this genuinely helped?”
8. **Control** — “What should I always ask before I read, change, send, share,
   spend, or publish anything?”

For `personal`, focus on goals, responsibilities, routines, decisions, and
constraints. For `work`, focus on value, priorities, repeated work, tools,
people, and risk. For `both`, ask one cross-cutting question before adding a
branch-specific question.

After every answer:

- reflect the meaning in one sentence;
- distinguish confirmed facts, inference, and unknowns;
- update the completed count and next question in `you/SETUP.md`;
- save no sensitive or credential value.

## Confirm the orientation

Show a concise summary:

- chosen path;
- current world;
- desired change;
- repeated friction;
- current information/tools;
- affected people;
- proof;
- control boundaries.

Ask what should change before the summary becomes durable. After confirmation:

1. update the relevant files under `you/`;
2. update relevant files under `work/` for work or combined discovery;
3. create or update one project when a real outcome exists;
4. set `stage: opportunity_map`;
5. follow `system/workflows/discover-opportunities.md`.

## Opportunity handoff

Do not finish setup with only a profile and skill candidate. The first 1.0
payoff is an evidence-linked Opportunity Map. After the map:

- the user may select one;
- ask to refine;
- say none fit;
- or stop with the map saved.

Set setup `complete` only when the confirmed durable context and first map
exist. A selected system and Build Mode may happen later.

## Restarting

Do not erase confirmed files. Preview what would be superseded, what remains
user-owned, and what new interview state would be created. Require explicit
confirmation before destructive reset.
