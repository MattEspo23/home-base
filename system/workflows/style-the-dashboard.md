# Style the dashboard

Use this workflow when the user wants their dashboard to look or work
differently, in any words: “redesign my Home Base in this style,” “make it
look like this screenshot,” “calmer,” “my brand colours,” “use the soft
theme,” “add a card for my reading list,” or “put it back.”

Do the look they ask for. Never refuse one because it is not a built-in
setting; pick the lightest place that achieves it.

## 1. Understand and confirm once

Take what they gave you: words, a screenshot, colours, a preset name, or a
mix. Ask a question only if you truly cannot tell what they want. Then say in
one or two sentences what you will change and where, and save after they say
yes. No forms, no checklists.

## 2. Pick the lightest place

All of these live in `instance/dashboard/`, which updates never touch.

- **Colours, fonts, corners, spacing, light or dark:** write
  `instance/dashboard/theme.json`. If a preset in `system/dashboard/themes/`
  (`precise`, `soft`, `night`, `calm`) is close, copy it and change only what
  differs. The settings are listed under “Make it yours” in
  `system/dashboard/README.md`.
- **Anything else visual** (heading sizes, hiding or moving things, label
  style, borders, a different layout): add `instance/dashboard/theme.css`. It
  loads after everything else and can override any token from
  `system/dashboard/src/styles.css` or any rule.
- **New cards or pieces with their own content:** add an instance module
  (`instance/dashboard/modules.json` and
  `instance/dashboard/modules/<id>/`; see “Private modules” in the README).
- **Only possible by changing the app itself:** edit `system/dashboard/src/`
  and rebuild with `node system/dashboard/build.mjs` (needs Node.js 22.13 or
  later). First tell the user, in one plain sentence, that future updates will
  keep this change and ask how to combine it with theirs.

Before replacing a file, keep the old one next to it (for example
`theme.previous.json`) so “put it back” is one step. Deleting `theme.json`
and `theme.css` brings back the default look.

## 3. Show it

Run `node system/dashboard/preview-theme.mjs`. It checks the theme the same
way the dashboard does and, when Chrome or Chromium is installed, saves
pictures on fictional sample data at desktop and phone width, in light and
dark, without opening the user’s own dashboard. Show the pictures, or ask the
user to reload their dashboard. Adjust until they are happy.

## Quiet safety nets

Mention one only when it matters.

- Text that would be hard to read keeps the default colour for that pair, and
  the page footer says which.
- A `theme.json` the dashboard cannot use is skipped, and the footer says why.
- The page loads nothing from the internet, because it shows private things:
  use fonts already on the computer and keep images and styles inside the
  files.
- A screenshot of another product is inspiration: take its feel, not its
  logos, names, or images.

## Saving credits

Small files, presets when one is close, and no rebuild unless the app itself
changes.

## Record

If the user says this is how they like things in general (“I like warm,
rounded looks”), offer to note it in `you/PREFERENCES.md`.
