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

| Element    | Decision                                                                                                                                                                             | Why                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Typeface   | **Rubik**, bundled with the app (never loaded from Google's servers)                                                                                                                 | One family for all four languages: Hebrew, Arabic, Cyrillic and Latin. Rounded and warm, readable at small sizes. SIL OFL license |
| Icons      | Our own line-icon set in SVG, 24 px grid, 2 px stroke, rounded joins; the active tab uses a **filled** version                                                                       | Consistent weight in every language and system; no icon font, no third party; RTL-aware (arrows flip)                             |
| Color      | The same contrast-tested tokens, plus a deeper brand shade for gradients and elevation tokens; the community's brand color still overrides `primary`                                 | Contrast stays proven by `contrast.test.ts`                                                                                       |
| Buttons    | Sizes `md` (48 px) and `sm` (40 px, still ≥ 24 px target, used only in dense lists), an optional leading icon, soft shadow on primary, pressed scale 0.98, hover on the web          | Clear hierarchy: primary, secondary (soft), ghost (outline), danger                                                               |
| Menu (app) | A tab bar with an **active pill** behind the icon, filled icon and bold label for the current tab, a soft top shadow, and safe-area padding                                          | The current tab is visible by shape, weight and color, not color alone (WCAG 1.4.1)                                               |
| Cards      | Radius 20, soft two-layer shadow, a hairline border in dark mode                                                                                                                     | Depth instead of outlines                                                                                                         |
| Dashboard  | A **side menu** grouped into sections (Moderation, Community, Settings) on wide screens, a menu button on narrow ones; refreshed buttons, tables and cards; the same font and tokens | 17 links in a wrapping top bar are hard to scan                                                                                   |
| Copy       | Hebrew without slash forms                                                                                                                                                           | The project's language rule                                                                                                       |

## Security, privacy, accessibility

- The font and the icons are bundled: no request to any other server (the privacy e2e test fails if
  the web app loads anything from another origin).
- Contrast: text ≥ 4.5:1, controls and focus ring ≥ 3:1, in light, dark and higher-contrast modes
  (unit tests). The current tab is marked by shape and weight, not only color.
- Motion: the press scale and transitions are skipped with "reduce motion".
- Easy mode keeps its larger targets and text; RTL mirrors directional icons.
- Accessible names don't change; decorative icons are hidden from screen readers.

## Done

- **App:**
  - Rubik bundled (`lib/fonts.ts`; only the 4 weights in use, one family per weight, so no
    synthetic bold).
  - The SVG icon set (`components/Icon.tsx`).
  - `Button`: sizes `md` and `sm`, a leading icon, depth, hover and press feedback, no motion with
    reduce motion.
  - The menu: an active pill, a filled icon and a bold label; the bar grows with the system text
    size, up to 1.5×.
  - Cards (`useCardStyle`, with the shadow outside `overflow: hidden` for iOS).
  - Banners with an edge and an icon.
  - A gradient hero (`HeroBackground`, `lib/color.ts`) that only moves away from the text color.
  - Check-in entry with the shield icon.
  - Hebrew copy without slash forms.
  - No letter-spacing on Arabic.
- **Dashboard:**
  - A side menu in three sections. On narrow screens it opens from a Menu button: Escape closes it
    and returns focus to the button, and picking a page closes it and moves focus to the page.
  - Rubik (variable, split by script); header, buttons, cards, fields and tables refreshed.
  - The header isn't sticky on small screens or at high zoom.
  - CSS only (the dashboard's CSP allows no inline styles).
- **Found on the way, fixed:**
  - Tab labels were clipped by the bar's fixed height.
  - On a phone the dashboard was wider than the screen. Auto margins sized `main` to the wide
    table, and visually hidden text inside tables escaped their scroll frame (an older bug).
- **Independent review (before merge):** no security issue. Every finding was fixed:
  - Tab labels at large system text sizes.
  - Focus lost after picking a page from the dashboard menu.
  - Hebrew: "מי מעניין אותי", gender-identity labels as identities, "looking for" kept open,
    gender-neutral templates.
  - Synthetic bold on the web.
  - Leftover `fontWeight` on Rubik.
  - The side menu's height.
  - The sticky header at reflow sizes.
  - The iOS card shadow.
  - Letter-spacing on Arabic.
  - Rubik's license (SIL OFL 1.1) in `NOTICE` and `licenses/Rubik-OFL.txt`.
- **Tests:**
  - Unit: `test/hero.test.ts`, which shows the gradient never lowers text contrast for any brand
    color, in light or dark.
  - e2e `pnpm --dir e2e design` (en, he, light, dark):
    - axe 0.
    - Rubik in use, and no request to other origins.
    - The current tab is marked by a bolder face.
    - No clipped tab label. I checked this fails with the old bar.
    - The dashboard on a phone: no horizontal scroll (checked it fails before the fix), the menu
      opens and closes, and focus is kept.
  - A regression run of 37 e2e suites on the new design, all passing with axe 0, plus
    `admin-a11y`.
  - Screenshots `210`-`213`.
- 📘 To check on real devices: native font loading, shadows, and the tab bar at the largest
  system text size.
