---
name: ui-color-surfaces
description: Use when defining a color palette, dark mode, borders, shadows, border radius, or elevation for a web app or site.
---

# Color and Surfaces

## Palette

- Define 4 to 6 named roles as CSS variables: background, surface, text, muted text, accent, and a status color only if needed
- One accent. Use it for the primary action and a small number of emphasis points, not for decoration.
- Derive tints and borders from the background and text colors instead of adding new hues
- Avoid pure #000 and pure #fff for large areas unless the brief wants that harshness
- Check contrast: 4.5:1 for body text, 3:1 for large text and UI boundaries
- Do not rely on color alone to convey state. Pair with an icon, label, or shape.

## Dark mode

- Build it from the same roles, not by inverting
- Raise surfaces by making them lighter, not by adding heavier shadows
- Reduce saturation of the accent slightly so it does not vibrate on dark backgrounds
- Respect prefers-color-scheme and allow a manual override

## Radius

- Set a role-based system: small for inputs and buttons, medium for containers, full only for pills and avatars
- Nested elements get a smaller radius than their parent
- Zero radius is a legitimate choice if applied consistently, not as a reflex

## Elevation and borders

- Choose one primary way to separate surfaces: border, background shift, or shadow. Do not stack all three.
- Reserve real shadows for things that float: menus, dialogs, popovers
- Use 1px borders in a color only a little different from the surface
- Avoid the same light grey box shadow under every card

## Gradients and effects

- Use gradients only when they represent something (heat, progress, depth in a chart)
- No decorative blur blobs, no glow behind headings
