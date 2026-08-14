---
name: youtube-action-plan
description: Turn a YouTube video, transcript, or reliable summary into a small application plan with evidence, actions, and a review point. Use when a user wants to apply a video's useful ideas, separate insight from entertainment, or convert passive notes into a bounded experiment.
---

# YouTube Action Plan

Convert one source into a short learning loop instead of an exhaustive summary.

## Source boundary

Use a YouTube URL only when supported captions or an accessible transcript are
available. Otherwise ask for a transcript or reliable summary. Preserve the
source URL and distinguish what the creator said from your inference.

## Workflow

1. State the video's central claim and the evidence or examples supporting it.
2. Separate ideas that are interesting from ideas that could change the user's
   work, decisions, or behavior.
3. Select at most three actions. Each action must be small enough to try within
   seven days and specific enough to observe.
4. Define the smallest proof for each action: what should happen, what evidence
   to save, and what would count as a failed or inconclusive test.
5. Schedule one review point. At review, keep, revise, or discard each action
   based on what actually happened.

## Output

Return:

- source and central claim;
- ideas worth keeping;
- ideas intentionally ignored and why;
- a maximum of three seven-day actions;
- proof for each action;
- one dated review question.

Do not invent claims from a title or thumbnail and do not turn every idea in the
video into a task.
