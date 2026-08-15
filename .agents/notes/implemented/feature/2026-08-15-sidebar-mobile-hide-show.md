# Agent Note: Narrow viewports hide the sidebar behind a floating show/hide toggle

Status: implemented

English | [中文](2026-08-15-sidebar-mobile-hide-show.zh.md)

## Problem

On phone-width viewports the sidebar never leaves the screen. Below the auto-collapse breakpoint it shrinks to the 56px control rail — still eating column width on a 375px phone, and its expand affordance is the fish/panel hover swap in the rail's top corner, a desktop hover pattern that reads poorly on touch. Users want the sidebar fully out of the way by default and one clear mid-height control to bring it back.

## Decision

Below `SIDEBAR_AUTO_COLLAPSE` the sidebar now hides entirely: the closed track resolves to zero width instead of the rail. A floating arrow button at the boundary's mid-height is the drawer toggle — when hidden it sits flush at the frame's left edge as a nub pointing right ("show"), when shown it straddles the column border pointing left ("collapse"); it rides the same track transition as the columns. The chevron's `aria-label` and `aria-expanded` come from the new `layout` locale namespace (same copy as the sidebar's own toggle).

Mechanics: the concession solver gains a `closedSidebarWidth` parameter (default `SIDEBAR_COLLAPSED`, so existing callers and the wide closed rail are untouched) and AppFrame passes 0 for the narrow hidden state; the layout store's existing `narrowExpanded` override is the show/hide switch, with no store changes. Drag resizing is a desktop affordance and does not render below the breakpoint. The hidden column keeps its subtree mounted (slot state survives the drawer), but `visibility: hidden` flips only after the track slide finishes — so the shell's collapse fade still plays against the moving column, and the rail controls drop out of the a11y tree and tab order instead of remaining focusable at zero width.

## Alternatives considered

- **Keep the rail and its top-corner toggle**: rejected — the rail still takes column width on phones, and the hover-swap affordance does not survive touch.
- **Overlay drawer sliding over the center column**: rejected — the grid-track animation already exists; an overlay would need a new layer and backdrop, and the center column would reflow underneath instead of absorbing the full width.
- **Hide via the store preference (0)**: rejected — the preference is the wide closed state; re-widening must restore the pre-squeeze layout, which the `narrowExpanded` override already preserves.

## Consequences

Phone rows default to the full-width conversation; one tap shows the sidebar and another hides it, with the arrow riding the moving border. The 56px rail remains the desktop collapsed presentation (closed preference), and wide behavior is unchanged. The conversation-column-overflow e2e sweep re-records: at narrow stops the column widens by the rail width, so the glow-bleed table and its vacuity-guard assertion were updated to match. The zero-width hidden column keeps slot state alive (search text, expanded tree) across show/hide.
