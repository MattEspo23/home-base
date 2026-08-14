# Learning loop

Home Base should improve through normal work without turning every conversation into permanent clutter.

## The loop

1. **Notice** — identify a correction, decision, preference, useful fact, repeated task, exception, or outcome.
2. **Classify** — decide whether it belongs in `you/`, `memory/`, `knowledge/`, `projects/`, `skills/`, `tools/`, or only the current conversation.
3. **Propose** — show the candidate learning and why it may help later.
4. **Confirm** — ask when wording, consequence, sensitivity, or conflict matters.
5. **Promote** — update the smallest appropriate file and its index.
6. **Use** — apply it in later work.
7. **Review** — mark old guidance superseded instead of quietly keeping contradictions.
8. **Reuse** — run the same or equivalent task again and compare the result.

## Promotion rules

| Observation | First home | Promote when |
|---|---|---|
| A direct correction from the user | `memory/CORRECTIONS.md` | The correction is understood and the user confirms the durable wording |
| A standing working preference | `you/PREFERENCES.md` | It applies beyond the current task |
| A decision with future consequences | `memory/DECISIONS.md` | The decision is made, not merely considered |
| A fact or reference | `knowledge/` | Its source and confidence are clear |
| A desired outcome | `projects/` | It needs tracking, a next action, or proof |
| A repeated process | `skills/` | The trigger, outcome, real steps, exceptions, and completion proof can be reviewed |
| A useful external tool or access idea | `tools/` | The outcome, minimum access, exclusions, approval points, test, and disconnect path are clear |
| A one-off detail | Current conversation | Usually never |
| An unclear possibility | `inbox/LEARNING-CANDIDATES.md` | The user or later evidence resolves it |

## Corrections

When the user says the agent was wrong:

1. fix the current work;
2. state the corrected understanding;
3. determine whether future scope is already explicit:
   - “always,” “never,” “from now on,” “going forward,” or “by default” confirms that it is standing guidance;
   - otherwise ask whether the correction should apply in future;
4. when future scope is confirmed, check the relevant durable files for a conflict and record the corrected wording in the smallest appropriate home;
5. check for conflicting durable files.

Use `you/PREFERENCES.md` for a standing work or response preference. Use `memory/CORRECTIONS.md` when the correction replaces a broader factual or operating assumption that should remain traceable. Do not duplicate the same full rule in both places.

Do not defend the old answer, acknowledge a standing correction without saving it, or hide the correction in a vague note. End by telling the user what durable wording changed.

## Skill candidates

Treat a workflow as a skill candidate when:

- the user says they repeat it;
- the same process appears more than once;
- consistency or delegation matters;
- the task has meaningful decision points or a completion check.

Offer the skill-builder interview. Do not invent missing steps just to finish the file.

If the user knows work feels repetitive but cannot name the best candidate, offer the SOP-discovery workflow before asking for detailed steps.

## Session closeout

Before closing meaningful work, ask:

> I noticed a few things that may be useful next time. Want me to show you what I would remember or turn into a workflow?

If yes, present no more than three candidates at once. For each, show:

- the proposed durable wording;
- where it would live;
- why it may help;
- whether it conflicts with anything already recorded.

If no durable learning emerged, say so plainly and stop.

## Suggestions

- Offer at most one unsolicited idea per active session.
- Record the session, evidence, count, status, and next eligible revisit in
  `ideas/INBOX.md` or `ideas/REVIEWED.md`.
- Treat “no” as durable.
- Reopen a declined idea only when new evidence changes a goal, tool,
  constraint, priority, feasibility, cost, or risk.
- Explain the new evidence and ask whether the user wants to reopen it. The
  user—not Home Base—decides whether the change is material enough.

An explicit opportunity review may show up to three ranked ideas and does not
consume the ordinary unsolicited-suggestion budget.

## Changed-result proof

Do not call storage “learning.” A system-learning receipt requires:

1. a first run with saved input and proof;
2. a specific observed problem or correction;
3. proposed durable wording and user confirmation;
4. the smallest appropriate change;
5. a second run of the same task without restating the correction;
6. a comparison showing the result changed in the intended direction.

Record the receipt in the system’s `LEARNINGS.md` and `PROOF.md`.

## Maintenance

- Keep index files concise.
- Date decisions, corrections, and sourced knowledge.
- Prefer links over duplicated paragraphs.
- Mark outdated material `superseded` with a pointer to the replacement.
- Periodically ask whether active goals, projects, and standing preferences are still current.
