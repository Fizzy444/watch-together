---
name: ui-motion
description: Use when adding animation, transitions, hover effects, scroll effects, or page-load sequences to a web interface.
---

# Motion

Motion should explain a change or direct attention. If it does neither, remove it.

## Rules

- Respond to user actions: opening, closing, expanding, reordering, confirming. These earn motion.
- For non-user-triggered motion, allow at most one deliberate moment per page, such as a single load sequence or one reveal of the key element
- Do not add fade-and-slide-up to every section, or a hover lift to every card
- Durations: 120 to 200ms for small state changes, 200 to 320ms for panels and dialogs, never above 500ms for UI
- Easing: ease-out for entering, ease-in for leaving, no bouncy springs in product UI
- Animate transform and opacity. Avoid animating layout properties like width, height, top, left.

## Accessibility

- Honor prefers-reduced-motion by removing movement and keeping instant or fade-only changes
- Never rely on motion alone to communicate state
- No autoplay looping animation that cannot be paused

## Pattern

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

## Loading and feedback

- Prefer skeletons shaped like the final content over spinners for content areas
- Buttons show a pending state immediately after click
- Success is confirmed near the place of action, not only in a distant toast
