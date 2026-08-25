# Mountain Runners Design Direction

## Purpose

Mountain Runners is a non-profit sports association from Bergueda. Its site
must feel local, useful, direct, energetic and trustworthy.

It is not a commercial race landing page, a gym website, a sportswear
campaign, a SaaS product or a dark sports-tech interface.

## Visual Direction

- The identity comes from the real club kit and logo: white, intense red and
  black.
- The homepage may be the strongest identity moment, using a red field, a
  controlled black brush transition and authentic club or mountain imagery.
- The rest of the site is light-first. White and warm white should carry most
  page backgrounds.
- Black creates structure through typography, rules, labels, logo areas and
  occasional dark sections; it must not become the default page background.
- Red is an identity colour, not a generic button colour. Use it deliberately
  for emphasis, dates, active states and significant actions.
- Do not introduce unrelated brand colours, generic decorative gradients or
  lifestyle palettes. Controlled brand-colour overlays and subtle textures may
  support image legibility or a deliberate editorial transition.

## Typography

- Use a condensed, strong display face for headings, dates and compact labels.
- Use a highly legible sans-serif for body copy, navigation and practical
  information.
- Short headings and labels may be uppercase; longer editorial titles should
  favour readability.
- Display typography must feel strong without turning every page into a race
  poster.

## Operational Design System

Ordinary styles use named Tailwind utilities backed by a closed `@theme` scale.
Custom CSS is reserved for selectors, cascades, pseudo-elements, markdown,
complex states and structures that named utilities cannot express clearly.
Do not invent per-page spacing, tracking or shadow values.

Near-equal historical values are normalized to the scale below. New work must
use these roles. If a screen needs something outside the scale, change the
scale in this document first.

### Closed scales

**Spacing**

| Token / utility                       | Value                         | Use                       |
| ------------------------------------- | ----------------------------- | ------------------------- |
| `--page-gutter` / `page-frame`        | `clamp(1.25rem, 4vw, 2rem)`   | Horizontal page inset     |
| `--spacing-section` / `py-section`    | `clamp(3.5rem, 7vw, 6rem)`    | Vertical section rhythm   |
| `--spacing-card` / `p-card`           | `clamp(1.5rem, 3vw, 2.25rem)` | Bordered card padding     |
| `--spacing-action` / `py-action`      | `0.85rem`                     | Compact CTA block padding |
| `--space-2`…`--space-4`, `--space-12` | fixed rem steps               | Small local gaps only     |
| Tailwind `gap-*`                      | default scale                 | Prefer over bespoke gaps  |

**Tracking**

| Token               | Value     | Use                          |
| ------------------- | --------- | ---------------------------- |
| `tracking-display`  | `0.06em`  | Compact display / nav titles |
| `tracking-label`    | `0.08em`  | Uppercase labels, meta, CTAs |
| `tracking-headline` | `-0.03em` | Large display headlines      |

**Leading**

| Token                | Value         | Use                            |
| -------------------- | ------------- | ------------------------------ |
| `leading-display`    | `0.92`        | Large uppercase display titles |
| `leading-action`     | `1.2`         | Compact CTAs and control text  |
| `leading-copy`       | `1.6`         | Body and supporting copy       |
| Tailwind `leading-*` | default scale | Everything else                |

**Shadow**

| Token                  | Value                   | Use                        |
| ---------------------- | ----------------------- | -------------------------- |
| `shadow-action`        | `0.35rem 0.35rem 0` ink | Default hard action shadow |
| `shadow-action-accent` | `0.35rem 0.35rem 0` red | Accent / hover hard shadow |
| `shadow-action-lg`     | `0.5rem 0.5rem 0` red   | Large panel hard shadow    |

**Type sizes**

| Token               | Value                         | Use                         |
| ------------------- | ----------------------------- | --------------------------- |
| `text-display`      | `clamp(3.5rem, 9vw, 7.5rem)`  | Page and detail heroes      |
| `text-display-home` | `clamp(2.6rem, 7vw, 5.25rem)` | Homepage hero only          |
| `text-section`      | `clamp(1.8rem, 4vw, 3rem)`    | Section titles site-wide    |
| `text-action`       | `0.8rem`                      | Compact CTA text            |
| `text-meta`         | `0.7rem` / leading `1.4`      | Status, kickers, small meta |

### Composition roles

- **Section shell.** Prefer `PageSection` for the standard frame, title bar and
  body measure. Do not hand-roll `page-frame page-section py-section` again.
- **Action control.** Compact uppercase CTAs share `text-action`,
  `leading-action`, `tracking-label`, `py-action` and `shadow-action` (or the
  accent / large shadow tokens when the control needs them).
- **Action link.** Compact uppercase text links use `tracking-label` and
  `action-underline`.

## Composition

- Use an editorial, responsive layout with generous whitespace and a clear
  reading order.
- On mobile, content must be fast to scan and practical information or actions
  must remain easy to find.
- Create rhythm with rules, dividers, varied column spans and image crops.
- Avoid building pages from repeated generic rounded cards. A small repeated
  set of structured programme cards is acceptable when it makes practical
  choices easier to scan, as on the school hub.
- Dark and red fields are deliberate moments of contrast, not page shells.

## Content Patterns

- Actions should usually be understated text links or outline treatments. Use
  compact red actions only when the action is central to the page.
- Events are agenda entries, not commercial cards. Prioritise date, location,
  discipline, club relationship, status and the relevant action.
- Schools are structured programmes. Detail pages prioritise suitability,
  schedule, location, price and registration status.
- Membership is a practical association service, not a sales funnel.
- Collaborators should appear in a sober directory or institutional wall.
- Documents and external resources must be clearly labelled and communicate
  their availability.

## Brush Motif

- The rough black brush transition from the club kit is a signature accent.
- Use it at major editorial transitions, on red fields or as a limited graphic
  separator.
- Never place it behind body text or repeat it throughout a page.

## Images

- Prioritise authentic images of members, training, races, volunteers and the
  Bergueda landscape.
- Use high-contrast, documentary-style crops with real movement and people.
- Use overlays only when required for text legibility.
- Avoid polished fitness advertising, generic summit poses and decorative
  collage layouts.

## Accessibility And Interaction

- Maintain WCAG AA contrast for text and interactive states.
- Keyboard focus must always be visible and high contrast.
- Never use colour as the only way to communicate status.
- Interactions should use restrained changes of colour, underline or border.
  Avoid exaggerated scale effects and decorative animation.

## Never Use

- Dark-first page layouts.
- Generic commercial image-on-top cards repeated across a page; structured
  school programme cards are the documented exception.
- Carousels, sliders or sponsor marquees.
- Dashboard-like controls unless essential for scanning events.
- Generic SaaS panels, glass effects, large shadows or pill-heavy interfaces.
- Topographic map decoration.
- Green and blue outdoor palettes.
- Large red CTAs as the default action pattern.
