# Daily Follow-Up Brief learnings

## Confirmed reference learning

- Evidence: detailed first-run drafts are longer than the target review style
- Proposed wording: default to concise draft suggestions
- Confirmation: acceptance-fixture confirmation
- Change: `preferences.json` durably stores `summaryStyle: concise`
- Test: run the same synthetic input again
- Result: the reference runtime reads the preference file; queue and priority
  stay stable while draft text becomes shorter

## Declined

None.

## Boundary

The reference proves deterministic changed-result behavior. It is not yet a
real-user longitudinal claim.
