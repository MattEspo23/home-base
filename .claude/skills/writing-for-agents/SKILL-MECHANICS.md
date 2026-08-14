# Skill mechanics

The skill-specific branch of [`writing-for-agents`](SKILL.md): what changes when the document is a skill — frontmatter, the invocation choice, and router skills. Everything else about writing it is the universal reference in `SKILL.md`.

## Invocation

Two choices, trading the two loads:

- A **model-invoked** Skill keeps a trigger-rich `description` and allows implicit invocation in `agents/openai.yaml`, so the agent can reach it autonomously. You can still type its name: model invocation adds discovery without removing human invocation. The description is the Skill's top-level context pointer, so keep it precise enough to justify its standing context load.
- A **user-invoked** Skill keeps the required `name` and `description` frontmatter, but sets `policy.allow_implicit_invocation: false` in `agents/openai.yaml`. Only the human explicitly choosing the Skill should start it. This reduces accidental invocation, but it spends cognitive load because the person must remember that it exists.

Pick model-invocation only when the agent must reach the skill on its own, or another skill must. If it only ever fires by hand, make it user-invoked and pay no context load.

Shared reference that two user-invoked skills both need can live in neither — with no descriptions, neither can fire the other. Push it to a plain file outside the skill system: external reference any skill can point at.

## Splitting by invocation

The invocation cut of splitting (the sequence cut lives in `SKILL.md`): split off a model-invoked skill when you have a distinct leading word that should trigger it on its own — a trigger word you actually use in your prompts — or another skill must reach it. You pay context load for the new always-loaded description, so that independent reach has to be worth it.

## Router skills

When user-invoked skills multiply past what you can remember, that piled-up cognitive load is cured by a **router skill**: one user-invoked skill that names the others and when to reach for each, so the human has one skill to remember instead of many. It can only hint, never fire them: user-invoked skills have no description, so nothing but the human can reach them.
