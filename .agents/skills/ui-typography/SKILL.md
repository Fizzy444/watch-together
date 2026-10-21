---
name: ui-typography
description: Use when choosing fonts, setting type scale, line length, weights, or fixing text that looks flat, cramped, or generic in a web UI.
---

# Typography

Type carries most of a page's personality. Decide it deliberately.

## Choosing faces

- Use one family or two. If two, make them clearly different in structure (for example a grotesque with a text serif), not near-twins.
- Do not default to the same few faces you would pick for any project. Match the face to the subject and audience.
- Prefer faces with several real weights and good numerals. Check that tabular figures exist for any data UI.
- Load only the weights you use. Always provide a fallback stack that matches metrics reasonably.

## Scale and rhythm

- Define a scale once as CSS variables and use only those sizes
- A ratio between 1.2 and 1.333 suits most product UI. Marketing pages can go larger at the top of the scale.
- Body text: 16 to 18px on the web, line height 1.5 to 1.65. Serif body gets slightly more line height than sans.
- Headings: line height 1.1 to 1.25, slightly negative letter spacing at large sizes
- Keep line length under about 75 characters for reading text

## Treatments to avoid by default

- Setting labels in all caps with wide tracking
- Accenting one word in a headline with color or italics
- Small captions or eyebrows above every heading
- More than three weights visible on one screen
- Centered paragraphs longer than two lines

## Data UI

- Use tabular numerals for columns of numbers and right-align them
- Keep units and labels in a quieter weight than the value
- Truncate with an ellipsis only where the full value is available on hover or in a detail view
