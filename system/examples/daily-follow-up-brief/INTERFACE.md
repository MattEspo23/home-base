# Daily Follow-Up Brief interface decision

## No-UI receipt

The generated Markdown brief is a useful first version. It can be reviewed,
searched, and archived without another interface.

## Justified local UI

A small dashboard materially improves:

- priority scanning;
- the separation between next action and draft;
- visibility of synthetic mode;
- visibility of the no-send boundary;
- mobile review.

The interface has no authentication, provider connection, form submission, or
send control. It reads checked-in synthetic data from `interface/demo-data.js`.
