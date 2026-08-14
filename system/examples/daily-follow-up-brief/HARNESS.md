# Daily Follow-Up Brief harness

## Trigger

Run explicitly when the user asks for the daily follow-up review.

## Inputs

- Required: labeled inbox and calendar JSON
- Optional: confirmed summary-style preference
- Excluded: credentials, real PII, unrelated mail, send authority

## Workflow

1. Validate the synthetic input shape.
2. Keep only records with `needs_reply`.
3. Add priority for urgency, age, and an upcoming event.
4. Sort high priority first.
5. Create draft-only next actions.
6. Mark every send `blocked_pending_user_approval`.
7. Render Markdown, JSON, and local interface data.

## Completion proof

The deterministic proof suite verifies queue size, order, send disablement,
artifact generation, and a changed concise second run.
