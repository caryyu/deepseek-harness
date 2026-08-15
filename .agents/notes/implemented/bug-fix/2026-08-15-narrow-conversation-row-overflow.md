# Agent Note: Narrow conversation rows collapse header utilities and truncate the model name

Status: implemented

English | [中文](2026-08-15-narrow-conversation-row-overflow.zh.md)

## Problem

On phone-width rows (~375–430px viewports), two fixed-width controls escape the conversation column. The Session Header's 111px `Session log` capsule sits in a `flex: none` utilities cluster at the right edge and pushes past the column edge; the composer's trailing cluster (model trigger capped at 220px, context meter, send button) also refuses to shrink, so the model-name chip overflows and the send button leaves the card. The model trigger already carried ellipsis CSS, but ellipsis can only engage when the trigger actually loses width, and the non-shrinking trailing cluster never lets that happen.

## Decision

The Session Header title row becomes a size container (`container-type: inline-size`), and the session-log-export header action swaps forms under an anonymous `@container (max-width: 480px)` query: the 111px capsule hides and a 32px ellipsis trigger takes its place; clicking it opens the shared Menu primitive dropdown whose single row is the same `Session log` action (download icon + label, disabled while a download is in flight, both triggers carrying `aria-busy`). The swap is pure CSS, so the two forms never coexist for a given row width, and the dropdown is the overflow seat future header utilities can share. The capsule label moved from hardcoded English into the package locale namespace (`action.sessionLog`); the English UI string is unchanged.

The composer row's trailing cluster becomes shrinkable (`flex: 0 1 auto` instead of `flex: none`), so under width pressure the model trigger yields space and its existing ellipsis truncates the model name. At the row's squeeze point (a 460px container query, the same cut as the sibling PermissionSelect collapse) the trigger drops the model name entirely and the effort level becomes its sole label — a name squeezed to a stub reads worse than none at all. Only triggers that carry an effort span drop the name: a model without reasoning keeps it as its sole identifier. The full label stays reachable through the trigger's `title` and `aria-label`.

## Alternatives considered

- **Viewport media query instead of a container query**: rejected — the conversation column width is not the viewport width (sidebar, split panes), so a viewport breakpoint either fires too late or collapses the capsule while the column still has room. The container query reacts to the row that actually overflows.
- **Icon-only capsule instead of a dropdown**: rejected — it hides the label without a discoverable path to the action on narrow rows; the ellipsis trigger keeps one tap to the same labeled action.
- **Shrinking the capsule text**: rejected — a labeled 111px capsule is the point; squeezing it into an unreadable stub trades one overflow for another.

## Consequences

Phone rows keep every control reachable: the Session log action is one tap deeper only on narrow rows, and the model chip shows only its effort level (name dropped) while the send button stays inside the card — the ellipsis covers the in-between band where the row still has some room. Wide rows are unchanged in behavior and layout — the container queries only match narrow rows and the trailing cluster only shrinks when the row genuinely runs out of space. The thresholds are container widths (480px header, 460px composer row), not viewport widths, so narrow desktop panels adapt identically. The e2e accessibility goldens (captured at 1680px) are untouched; the overflow triggers render only under the container queries and are `display: none` otherwise.
