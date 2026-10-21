---
name: publish-home-base-dashboard
description: Put the Home Base dashboard online on the user's own Vercel account, locked to their Vercel sign-in, so it opens on their phone and computer; also update it after changes or take it down.
---

# Put the Home Base dashboard online

Read `system/workflows/put-the-dashboard-online.md` from the Home Base root in
full and follow it.

Lock first: upload the placeholder, turn on Vercel Authentication for All
Deployments, and upload the real copy only after
`node system/dashboard/publish.mjs --check-locked` passes. Ask before every
upload. Never make it public, and never handle a Vercel token.
