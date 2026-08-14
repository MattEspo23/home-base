# Review interface and deployment

Use this workflow when deciding whether the system needs a form, dashboard,
site, application, or hosted surface.

## Interface decision

Start with:

1. conversation;
2. checklist or form;
3. local web view;
4. hosted interface.

Choose the first surface that materially improves visibility, repeat use,
handoff, or error prevention. Record the decision in `INTERFACE.md`.

When conversation or a checklist is enough, record a no-UI receipt. Do not
generate an interface for spectacle.

## Local proof first

For a justified UI:

- build it locally;
- use synthetic or approved non-sensitive data;
- verify the user job;
- record accessibility, error, and empty states;
- keep outside effects disabled.

## Deployment decision

Hosting is optional. If it materially helps:

1. inspect current provider options and official documentation;
2. record provider evidence and checked date;
3. preview destination, visibility, cost, non-secret environment variable
   names, domain, version, verification, worst case, and rollback;
4. require exact destination approval;
5. deploy only after that approval;
6. verify and demonstrate rollback.

Without exact approval, complete a deployment preview and local rollback
rehearsal only. Record the result in `DEPLOYMENT.md` and `PROOF.md`.
