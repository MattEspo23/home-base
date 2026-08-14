# Daily Follow-Up Brief proof

## Acceptance contract

- Claim: the reference turns synthetic read-only inputs into a useful
  draft-only review queue and local interface.
- Method: `node system/prove.mjs`
- Expected: deterministic order, two queue items, no send authority, generated
  artifacts, local UI assets, rollback, and a changed concise second run loaded
  from durable preferences.
- Observed: passed on 2026-07-26 through `node system/prove.mjs`. The same
  synthetic input produced two ordered draft-only queue items, three disposable
  output artifacts, sends disabled, and shorter second-run drafts after the
  confirmed concise-style change.

## Outside-action receipt

- Preview: local synthetic files only
- Approval: internal implementation request
- Changes: task-specific temporary output during proof
- Stop: any real account, data, send, or production deploy
- Remaining access: local files only
- Undo: remove temporary output; stop local server

## Two-run improvement receipt

- First run: detailed draft style
- Observed problem: drafts are longer than the user wants
- Confirmed correction: use concise draft suggestions
- Durable change: `preferences.json` stores `summaryStyle: concise`
- Second run: same synthetic input
- Comparison: second-run drafts are shorter and start with “Quick follow-up”
- User did not restate the correction: the same executable path reads the
  changed preference file before the second run

## Local interface receipt

- Command: `node system/examples/daily-follow-up-brief/serve.mjs`
- Observed: the interface, stylesheet, application script, and synthetic data
  returned successfully from `127.0.0.1:4173`
- Visible state: `Synthetic`, `Sends disabled`, and the stop gate
- Security boundary: loopback-only server, path containment, no-store,
  same-origin content policy, no external requests, and text-only DOM insertion
- Outside effect: none
