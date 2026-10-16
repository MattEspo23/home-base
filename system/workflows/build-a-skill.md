# Build a skill from real work

Use this workflow when the user wants to document an SOP, improve a repeated task, or teach Home Base how they do something.

## Define the candidate

First identify:

- the task name;
- what causes the task to start;
- the useful outcome;
- who performs or approves it;
- whether the user can walk through a recent real example.

Prefer a recent example over an idealized description.

## Interview one question at a time

Cover these areas, adapting to what is already known:

1. **Trigger** — What tells you it is time to do this?
2. **Inputs** — What must you have before starting?
3. **Real steps** — What do you actually do first, next, and last?
4. **Decisions** — Where do you choose between different paths?
5. **Exceptions** — What commonly goes wrong or needs judgment?
6. **Tools** — Which tools or files are involved? Do not connect them yet.
7. **Approval** — Which actions must the agent ask about at the moment they occur?
8. **Proof** — How do you know the task is finished and good enough?
9. **Example** — What does a successful result look like?

Ask follow-ups only where a missing answer would make the workflow unsafe or unreliable. Say explicitly when a step is still unknown.

## Draft

Use `templates/skill/SKILL.md` to create `skills/<kebab-case-name>/SKILL.md`.

The draft must include:

- valid `name` and `description` frontmatter;
- when to use and when not to use it;
- required inputs;
- numbered workflow;
- decision points and exceptions;
- approval and safety boundaries;
- completion check;
- at least one example or an explicit note that no example is confirmed;
- a learning-notes section for future revisions.

Set the skill status to `draft` until the user reviews the meaning.

## Review

Walk the user through:

1. the trigger and promised outcome;
2. the steps;
3. the decisions or exceptions;
4. the approval boundaries;
5. the completion proof.

Ask:

> If I followed this tomorrow, where would I still get it wrong?

Revise the draft. Mark it `active` only when the user trusts it for real use.

## Index and learn

Add one linked line to `skills/INDEX.md` under the section that matches its
status (Active, Draft, or Candidates):
`- [Skill name](<skill-name>/SKILL.md) — trigger: …; reviewed YYYY-MM-DD`.
Move the line when the status changes instead of adding a second one (see
Index entries in `system/WORKSPACE-CONTRACT.md`).

After the skill is used, compare the real run with the file. Propose specific updates for missing steps or changed conditions. Do not silently rewrite the trusted workflow during the task.
