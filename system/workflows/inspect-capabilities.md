# Inspect current capabilities

Use the Capability Doctor when a task may depend on a workflow, local command,
plugin, connector, authentication state, or provider permission.

Run the read-only receipt:

```bash
node system/inspect-runtime.mjs
```

Use `--json` for the typed record or `--output capabilities/<name>.md` to save a
dated user-approved receipt.

The doctor evaluates only each capability’s declared `all_of` and `any_of`
requirements. `not_applicable` is different from `absent`: a command-only
workflow does not fail because it lacks a connector, while a plugin-plus-
connector workflow does. Installed-but-disabled plugins, unconfigured
connectors, unknown/needed authentication, and unknown/insufficient permission
fail only where declared. Authentication never implies permission or authority
to act.

The live probe may read repository metadata, allowlisted command versions, and
host-reported plugin metadata. It must not read token/config contents, trigger
login or OAuth, call provider business data, change plugin/connector state, or
test a write. Treat the receipt as current environment evidence, not timeless
correctness proof.

Explain the result, what it can read or change, the smallest sufficient access,
a manual or narrower alternative, the direct-login surface, safe test, and
disconnect path. Planning or availability does not authorize action. Follow
`system/workflows/enter-build-mode.md` before using a capability externally.
