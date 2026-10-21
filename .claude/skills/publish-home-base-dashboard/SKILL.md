---
name: publish-home-base-dashboard
description: Put the Home Base dashboard online on the user's own Vercel account, locked to their Vercel sign-in, so it opens on their phone and computer; also update it after changes or take it down.
---

# Put the Home Base dashboard online

Read `system/workflows/put-the-dashboard-online.md` from the Home Base root in
full and follow it.

Confirm the Vercel account or team with the user first and pass
`--scope <scope>` to every `vercel` command; never upload to a team they did
not name. Lock first: upload the placeholder, turn on Vercel Authentication for All
Deployments, and upload the real copy only after
`node system/dashboard/publish.mjs --check-locked` passes. Ask before every
upload, unless the user asked for automatic updates and that standing yes is
recorded in `you/PREFERENCES.md`; then follow the workflow's automatic steps
(`--auto`, between two passing lock checks). Never make it public, and never
handle a Vercel token.
