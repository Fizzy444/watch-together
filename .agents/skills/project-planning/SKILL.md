---
name: project-planning
description: Use when starting a new project, a large feature, or any task spanning multiple files or more than an hour of work. Produces a short spec and milestone plan before coding.
---

# Project Planning

## Before code

Write a plan of at most one page:

- Goal: what the finished thing does, in two sentences
- Users and scenario: who uses it and how
- Scope: what is included and what is explicitly not included
- Stack: languages, frameworks, services, with one-line reasons
- Data: main entities and where they are stored
- Interfaces: endpoints, screens, or commands
- Risks: the two or three things most likely to go wrong
- Milestones: 3 to 6 steps, each ending in something runnable

## Rules

- The first milestone is the thinnest end-to-end slice that works, even if ugly
- Each milestone is verified by running it, with the command or click path stated
- If a requirement is ambiguous, pick the simplest reading, state the assumption, and continue
- Ask at most one question, and only if the answer changes the architecture
- Do not add features, services, or abstractions that are not in scope

## During

- Update the plan when scope changes and say what changed
- After each milestone, summarize what works, what does not, and what is next
- Keep a `docs/decisions.md` of choices made and why, a few lines each

## Finish

- Produce a working project, not an outline. Create the files, run them, and fix errors before reporting.
