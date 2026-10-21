---
name: ui-design-brief
description: Use before building any new page, screen, component set, or landing page. Forces a short design plan with real subject matter, tokens, and a self-review before any code is written.
---

# UI Design Brief

Run this before writing markup or styles. Skip it only for tiny edits to an existing, already-designed screen.

## Step 1: Ground the work

State in three lines:
- Subject: what the product or page is actually about, in concrete terms
- Audience: who uses it and in what situation (phone on a commute, analyst at a desk, parent at night)
- Primary job: the one thing the screen must help someone do

If any of these is unclear, propose one and say it is an assumption. Do not ask more than one question.

## Step 2: Write a compact token plan

Produce this before code:
- Color: 4 to 6 named hex values (background, surface, text, muted text, one accent, one status color if needed)
- Type: one or two families, the role of each, and a scale (for example 14, 16, 20, 28, 40)
- Shape: one radius for controls, one for containers, and a rule for when shadows appear
- Layout: one sentence describing the structure plus a small ASCII wireframe
- Alignment: left, centered, or justified, and why
- Memorable element: the single thing on the page that gets the boldness. Everything else stays quiet.

## Step 3: Review the plan against defaults

Ask: if I gave this prompt for a different product in the same category, would I produce this same plan? If yes, change the weakest part. Take cues from the subject's own world: its materials, vocabulary, tools, and printed or physical artifacts.

List what you changed and why in two or three lines.

## Step 4: Build, then critique

- Build to the plan, putting tokens in CSS variables first
- When done, name one thing that can be removed and remove it
- Confirm: mobile layout works, keyboard focus is visible, contrast passes, reduced motion is respected
