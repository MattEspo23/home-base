# Plan a tool connection safely

Use this workflow when the user asks what tools Home Base could use, wants to connect an application, or describes work that may benefit from access to another system.

This workflow creates a connection plan. It does not grant access,
authenticate, install anything, change an account, or send data. External
execution requires a separate Build Mode preview.

## Start with the outcome

Read `tools/INDEX.md`, the relevant project, and `system/SAFETY.md`.

Ask one question at a time:

1. “What would you like Home Base to help you accomplish?”
2. “Which tool holds the information or action today?”
3. “Would Home Base only need to read information, or also draft, create, update, send, or delete?”
4. “What information would it need—and what should stay private or out of bounds?”
5. “Which actions should always require you to approve them at that moment?”
6. “How often would this help, and how would you know the connection is working correctly?”
7. “What is the maximum number of records or actions this should touch in one
   approved run?”
8. “Which people could see or be affected by the result?”

Do not request passwords, tokens, recovery codes, private keys, or secret values. Record only the name of the secure place where credentials are managed, if useful.

## Recommend the smallest safe connection

Prefer:

1. no connection when a manual import or copy is enough;
2. one-time import before ongoing access;
3. read-only access before write access;
4. drafts before sends;
5. narrow data and project scope before account-wide scope;
6. reversible actions before destructive ones;
7. a human approval step for messages, publishing, purchases, deletions, account changes, and sensitive sharing.

State clearly when the requested outcome cannot be achieved with read-only access.

## Create a proposed plan

Use `templates/tool-connection.md` to create `tools/<kebab-case-tool-or-purpose>.md`.

The plan must include:

- desired outcome;
- tool and current source of truth;
- data needed and data explicitly excluded;
- minimum access level;
- allowed actions;
- ask-before actions;
- privacy or security risks;
- manual fallback;
- validation check;
- disconnect or rollback path;
- read/data scope and explicit exclusions;
- volume ceiling and affected third parties;
- credible worst case and undo;
- status `proposed`.

Add the plan to `tools/INDEX.md` using a portable relative path such as `customer-follow-up.md` or `tools/customer-follow-up.md`, never a local absolute machine path.

## Stop before access

Summarize the proposed connection, why the access is minimal, and what the user must review next.

Do not connect the tool during this workflow. If the user wants to continue,
first follow `system/workflows/inspect-capabilities.md`, then
`system/workflows/enter-build-mode.md`. Credential values are refused; the
user signs in directly on the provider’s surface.
