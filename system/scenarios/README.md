# Home Base 1.0 acceptance scenarios

These scenarios protect the product promise. Run them in clean copies of Home Base before making public claims.

`scenarios.json` defines the bounded cases and observable expectations. `WALKTHROUGH.md` explains how a human keeper reviews the experience.

The catalog covers:

- progressive personal, business, and combined discovery;
- Opportunity Map ranking, evidence, and “none fit” recovery;
- blueprint completeness and all four execution shapes;
- Build Mode consent, credential refusal, bounded reads, and scope-expansion stops;
- no-interface and justified-interface decisions;
- deployment preview and rollback;
- suggestion budgeting, durable declines, and changed second runs;
- capability fallback and safe product updates.

Run `node system/validate.mjs` for structural coverage and
`node system/prove.mjs` for deterministic behavior. Those checks do not replace
the named clean-copy and uncoached keeper runs required before public release.
