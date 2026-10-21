---
name: ui-layout-spacing
description: Use when structuring page layout, grids, spacing, responsive behavior, forms, tables, or dashboards, or when a UI feels cramped, uneven, or like a stack of identical boxes.
---

# Layout and Spacing

## Spacing system

- Use a single spacing scale (for example 4, 8, 12, 16, 24, 32, 48, 72) defined as variables
- Space groups tighter inside than between: related items closer, unrelated items farther
- Section padding is larger than component padding. Make that difference obvious.
- Do not center every container with the same max width. Pick widths by content: reading text narrow, tables and tools wide.

## Structure

- Let content decide layout. Lists of comparable items can be a table or a list. Only use cards when each item is a self-contained object people act on.
- Vary rhythm: not every section should be the same height and column count
- Align to a consistent left edge. Center alignment is for short, isolated pieces such as a title on an empty state.
- Prefer CSS grid for two-dimensional layout and flex for one-dimensional rows
- Avoid fixed pixel heights on content containers

## Responsive

- Design mobile first. Stack, then expand.
- Touch targets at least 44px tall
- Tables get horizontal scroll inside their own container, never on the page body
- Use clamp() for fluid type and spacing instead of many breakpoints
- Test at 360px, 768px, and 1280px widths

## Forms

- Labels above inputs, always visible, not placeholder-only
- One column unless fields are short and clearly related
- Show validation next to the field, in plain words, saying how to fix it
- Primary action aligned with the reading direction of the form

## Dashboards and data

- Lead with the number or state people check most often
- Charts get direct labels where possible instead of legends
- Provide empty, loading, and error states for every data region
