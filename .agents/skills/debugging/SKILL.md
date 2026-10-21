---
name: debugging
description: Use when something is broken, throwing errors, failing tests, behaving unexpectedly, or when a previous fix did not work. Enforces root-cause investigation before editing.
---

# Debugging

Do not guess-and-patch. Find the cause first.

## Process

1. Reproduce: get the exact error, input, and command that triggers the problem. If you cannot reproduce it, say so and ask for the missing detail.
2. Read the full stack trace or log. Identify the first line in the user's own code, not the library's.
3. Form one hypothesis and name the evidence that would confirm or reject it
4. Test the hypothesis with the smallest check: a print of one value, a single failing test, a minimal script
5. Fix the cause, not the symptom. If the fix is a try/except that hides the error, it is the wrong fix.
6. Re-run the original reproduction and the related tests
7. Add a regression test when the bug is likely to come back

## Rules

- Change one thing at a time
- If two attempts fail, stop and re-read the evidence. Do not stack a third patch on top.
- Check recent changes first: `git diff` and `git log -5`
- Check the environment: versions, env vars, working directory, missing dependency, stale cache
- Never delete or disable a failing test to make a run pass
- Remove any temporary debug output before finishing

## Report

Finish with three lines: root cause, the fix, how it was verified.
