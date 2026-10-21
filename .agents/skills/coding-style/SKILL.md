---
name: coding-style
description: Use on every code generation or edit task. Sets naming, structure, and commenting rules so generated code stays clean and consistent.
---

# Coding Style

## Hard rules

- Write code without comments. Express intent through names and small functions. Docstrings and comments are added only if the user asks for them.
- Match the existing style of the repository before applying any preference of your own
- Do not rename, reformat, or reorganize code unrelated to the task

## Naming

- Names describe purpose: `unpaid_invoices`, not `data2` or `result`
- Functions are verbs, values are nouns, booleans read as questions (`is_expired`, `has_access`)
- No single-letter names except loop indices and well-known math symbols

## Structure

- One function does one thing and fits on a screen
- Prefer early returns over deep nesting
- Avoid flags that change what a function does. Split into two functions.
- No dead code, no commented-out code, no unused imports or variables
- No magic numbers or strings. Name them as constants or config.

## Dependencies

- Do not add a library for something the standard library or an existing dependency already does
- Pin versions for anything added, and state why it was needed in your reply

## Output

- When changing files, list what changed in a few lines. Do not paste whole files back unless asked.
