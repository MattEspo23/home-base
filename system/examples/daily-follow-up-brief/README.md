# Daily Follow-Up Brief reference

This maintained Home Base 1.0 reference proves one complete, safe business
shape without real accounts or personal data.

## What it does

- reads labeled synthetic email and calendar records;
- creates a priority review queue;
- produces draft-only next actions;
- exposes a small local dashboard;
- keeps sends disabled;
- demonstrates a confirmed concise-style learning on a second run;
- rehearses deployment preview and rollback locally.

## Run the deterministic build

```sh
node system/examples/daily-follow-up-brief/build.mjs \
  --output /tmp/home-base-follow-up-proof
```

Use a task-specific temporary directory. The command writes the Markdown brief,
JSON data, and browser data script there.

The default build reads `preferences.json`. `--style detailed|concise` is an
explicit one-run override; it does not replace the saved preference.

## Open the reference interface

```sh
node system/examples/daily-follow-up-brief/serve.mjs
```

Then open the printed local URL. The interface uses only checked-in synthetic
data and has no send control.

## What this does not prove

- live Gmail or calendar access;
- real provider login;
- a production deployment;
- a send;
- universal connector support.

Those remain separate runtime, direct-login, exact-approval, and proof gates.
