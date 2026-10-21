---
name: ui-anti-slop
description: Use whenever generating or editing UI, CSS, Tailwind, React components, or landing pages. Lists the common tells of generic AI-generated interfaces and what to do instead.
---

# Avoiding Generic AI-Looking UI

Generated interfaces cluster around a small set of defaults. They are fine as deliberate choices for a specific brief, but not as reflexes. If the user's brief names a direction, follow it exactly.

## Visual tells to avoid by default

- Purple to blue or pink gradients on hero sections, buttons, or text
- Gradient washes and blurred glowing blobs behind content
- Every section turned into the same grid of identical rounded cards
- One border radius applied to everything, regardless of hierarchy
- The same soft grey drop shadow under every card
- Glassmorphism panels with no reason to show what is behind them
- Emoji used as icons in feature lists
- Near-black background with one neon accent as the automatic "modern" look
- Cream background with a serif headline and a clay or terracotta accent as the automatic "editorial" look
- Stock-looking hero: big headline, subtext, two buttons, three stat boxes

## Structural tells to avoid by default

- A tracked-out ALL CAPS eyebrow label above every heading
- Numbered markers like 01, 02, 03 on content that is not a real sequence
- Meta text joined with middle dots (A · B · C) everywhere
- Arrows appended to every link and button
- Highlighting a single word in a headline with color or italics
- Monospace font for small labels with no technical reason
- Three-column "feature" rows with an icon, a short title, and a vague sentence
- Fake testimonials, fake logos, fake statistics, and lorem-style marketing filler

## What to do instead

- Start from the real content and let its shape decide the layout. A table of data wants a table, not cards.
- Use structure only when it carries information: borders to group, numbers only for order, labels only when they clarify.
- Vary scale and density on purpose. Not every block needs equal weight.
- Pick radius, shadow, and border rules by role: controls, containers, overlays each get a decision.
- Spend boldness in one place. Keep the rest disciplined.
- Use real or realistic content. If you must invent content, make it specific to the product.
