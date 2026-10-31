# Phase 79: a visual design system (app and dashboard)

The product works and is accessible, but it doesn't look designed:

- The menu mixes emoji and Unicode symbols (✦ ☀ ♥ 💬 ☺) of different weights, which render
  differently on each system.
- Text uses the system font.
- Buttons are flat, with no icons, sizes or press feedback.
- Cards are pale outlines.
- The dashboard has a top bar of 17 wrapping links.
- Some Hebrew copy still uses slash forms ("ברוך/ה הבא/ה").

This phase gives both apps one visual language, without changing any behavior or accessible name
(every e2e test keeps working).

## Design decisions

| Element    | Decision | Why |
| ---------- | -------- | --- |
| Typeface   | **Rubik**, bundled with the app (never loaded from Google's servers) | One family for all four languages: Hebrew, Arabic, Cyrillic and Latin. Rounded and warm, readable at small sizes. SIL OFL license |
| Icons      | Our own line-icon set in SVG, 24 px grid, 2 px stroke, rounded joins; the active tab uses a **filled** version | Consistent weight in every language and system; no icon font, no third party; RTL-aware (arrows flip) |
| Color      | The same contrast-tested tokens, plus a deeper brand shade for gradients and elevation tokens; the community's brand color still overrides `primary` | Contrast stays proven by `contrast.test.ts` |
| Buttons    | Sizes `md` (48 px) and `sm` (40 px, still ≥ 24 px target, used only in dense lists), an optional leading icon, soft shadow on primary, pressed scale 0.98, hover on the web | Clear hierarchy: primary, secondary (soft), ghost (outline), danger |
| Menu (app) | A tab bar with an **active pill** behind the icon, filled icon and bold label for the current tab, a soft top shadow, and safe-area padding | The current tab is visible by shape, weight and color, not color alone (WCAG 1.4.1) |
| Cards      | Radius 20, soft two-layer shadow, a hairline border in dark mode | Depth instead of outlines |
| Dashboard  | A **side menu** grouped into sections (Moderation, Community, Settings) on wide screens, a menu button on narrow ones; refreshed buttons, tables and cards; the same font and tokens | 17 links in a wrapping top bar are hard to scan |
| Copy       | Hebrew without slash forms | The project's language rule |

## Security, privacy, accessibility

- The font and the icons are bundled: no request to any other server (the privacy e2e test fails if
  the web app loads anything from another origin).
- Contrast: text ≥ 4.5:1, controls and focus ring ≥ 3:1, in light, dark and higher-contrast modes
  (unit tests). The current tab is marked by shape and weight, not only color.
- Motion: the press scale and transitions are skipped with "reduce motion".
- Easy mode keeps its larger targets and text; RTL mirrors directional icons.
- Accessible names don't change; decorative icons are hidden from screen readers.

## Files

- `apps/mobile`: `lib/tokens.ts` (elevation, brand shades), `components/Icon.tsx` (new),
  `components/Button.tsx`, `app/(tabs)/_layout.tsx`, `components/AppText.tsx` (font),
  `app/_layout.tsx` (load the font), cards (`Card`, `ProfileCard`), the Hebrew strings.
- `apps/admin`: `styles.css`, `App.tsx` (side menu), the font files.

## Tests

- Unit: contrast for the new tokens; icons have no accessible name of their own.
- e2e: all existing suites, axe 0, en and he; new before/after screenshots of the main screens and
  the dashboard; a check that the web app makes no requests to other origins.
