---
name: ui-review
description: Use when asked to review, audit, critique, polish, or fix an existing UI, screenshot, component, or page. Produces a prioritized list of concrete fixes and applies them.
---

# UI Review

Review in this order. Stop expanding a category once you have its top issues.

## 1. Function and accessibility (fix first)

- Keyboard reachable, visible focus ring on every interactive element
- Contrast meets 4.5:1 for text and 3:1 for UI boundaries
- Touch targets at least 44px
- Form fields have visible labels and useful error text
- Semantic elements used (button, nav, main, label) instead of clickable divs
- Reduced motion respected
- No layout shift on load, images have dimensions

## 2. Hierarchy

- Is there one clear primary action per screen?
- Can the main point be found in three seconds?
- Are secondary details visually quieter than primary ones?

## 3. Consistency

- Spacing comes from one scale
- Radius, border, and shadow rules follow roles
- Same action, same wording everywhere
- States exist: hover, active, disabled, loading, empty, error

## 4. Generic-default check

Scan for the tells in ui-anti-slop. For each one found, decide: deliberate choice for this brief, or reflex? Replace reflexes.

## Output format

1. Top five problems, each with the exact location and the specific change to make
2. One thing to remove
3. Apply the fixes. Do not stop at the list unless the user asked for review only.
