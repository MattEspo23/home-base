# Skills

Skills are reusable workflows built from how the user actually works.

A good skill says:

- when it should run;
- what outcome it produces;
- what inputs it needs;
- the real steps and decisions;
- what requires approval;
- how completion is checked.

Say **“Help me turn this into a skill”** to start the interview.

If you are not sure what should become a skill, say **“Help me find a few things I repeat that might be worth turning into a skill.”** Home Base should recommend a small grounded candidate set before asking for detailed steps.

User-created skills live in `skills/<name>/SKILL.md`. They remain ordinary readable files so Home Base can use them across supported agents.

This user-owned directory is separate from the 42 maintained repository Skills
that ship under `.agents/skills/` and `.claude/skills/`. A Home Base update can
propose changes to a bundled Skill while preserving local customizations through
the three-way update review; it never treats this user-owned directory as an
update target. See `system/distribution/SKILL-CATALOG.md` for the bundled list.
