# Blueprint a system

Use this workflow after the user selects an opportunity or asks to design a
specific system.

## Deepen the selected branch

Ask only the unanswered questions needed for:

- outcome and user;
- current trigger, inputs, steps, decisions, and exceptions;
- durable context and knowledge;
- tools and capabilities;
- read, draft, write, send, publish, purchase, delete, and administer limits;
- smallest useful version;
- interface;
- local versus hosted choice;
- cost and care;
- proof, worst case, rollback, and disconnect.

Use a recent real example. Keep unknowns explicit.

## Create the system record

Create `systems/<system-name>/` from every file in `templates/system/`.
Complete `BLUEPRINT.md` first and update `systems/INDEX.md`.

The smallest useful version must have:

- a runnable artifact or executable workflow the user can use today;
- one safe test;
- reviewable completion proof.

Before a separate consequential approval, it excludes purchases,
subscriptions, sends, publication, sensitive permissions, production
deployment, domain changes, destructive actions, and third-party-visible
records.

## Choose the execution shape

Select one:

1. file-and-workflow system;
2. read-only or draft-first connected system;
3. conversation or local interface;
4. approved hosted web interface.

When the desired action is outside these shapes, complete the blueprint and
offer a manual or narrower route. Do not promise execution the runtime cannot
prove.

## Confirm before building

Show the complete blueprint and ask what should change. After confirmation,
update `you/SETUP.md`:

- set `stage: blueprint`;
- record the selected system as the current focus;
- set the next question or action to the first unfinished build step.

Then follow `system/workflows/build-a-system.md`.
