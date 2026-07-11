# Source-Anchored Microtrace benchmark

This lab compares two inputs for the same dynamic frontend bug:

1. Static condition: task description plus a normal ChangeHere element selection.
2. Trace condition: the same input plus a bounded source-anchored microtrace.

The 15 cases are implemented at `/?trace-lab` in the example app. Case definitions,
reproduction steps, and expected trace signals live in `trace-cases.json`.

Do not publish scores from a single agent run. For each condition, run at least three trials
with the same model, prompt, repository state, and tool permissions. Record:

- correct source localization;
- successful reproduction;
- first-pass functional fix;
- clarification turns;
- elapsed time and token usage.

The current commit provides the reproducible corpus and validates its coverage. It does not
claim that traces improve results before those controlled agent trials are run.
