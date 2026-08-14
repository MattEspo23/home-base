---
status: proven_reference
created: 2026-07-26
updated: 2026-07-26
opportunity: synthetic-reference
---

# System blueprint: Daily Follow-Up Brief

## Outcome and user

- User: solo service operator using synthetic proof data
- Desired outcome: review follow-ups in priority order without sending
- Why now: repeated follow-up work is easy to miss and rewrite
- Evidence: fresh-review synthesis selected a recurring, multi-tool,
  draft-first information task

## Current process

- Trigger: start-of-day review
- Inputs: labeled synthetic inbox and calendar records
- Steps: find replies needed, match upcoming events, rank, draft next actions
- Decisions: high urgency, age, and upcoming event affect priority
- Exceptions: completed records are excluded
- Current proof: `node system/prove.mjs`

## Smallest useful version

- Runnable artifact: deterministic Markdown/JSON brief
- Verifiable today: two queue items, stable order, sends disabled
- Outside version: live accounts, real PII, sends, production deployment

## System shape

- Execution shape: file_workflow
- Optional next shape: conversation_or_local_ui
- Trigger and inputs: explicit local run with synthetic JSON
- Outputs: `BRIEF.md`, `brief.json`, `demo-data.js`
- Maintenance: update only the labeled input contract and tested ranking logic

## Tools and capabilities

- Already available: files and Node.js
- Missing: any real provider connection
- Manual alternative: paste approved non-sensitive rows into a local copy

## Authority

- Read: synthetic sample only
- Draft: local suggestions only
- Write: task-specific output directory
- Send, publish, purchase, delete, administer: never

## Interface decision

- File output is already useful.
- Local dashboard improves scanning and makes the no-send gate visible.

## Deployment decision

- Local server is sufficient for proof.
- Production deployment is not approved.

## Proof and rollback

- Safe test: `node system/prove.mjs`
- Completion evidence: deterministic queue and generated artifacts
- Worst case: incorrect synthetic ordering
- Undo: discard the temporary output directory and stop the local server

## Next action

Run the full Home Base proof suite.
