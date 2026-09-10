---
name: Crux
description: An adaptive study companion whose session is one Cornell note page, with the tutor's memory of you written in the cue column.
colors:
  page: "#fcfcfa"
  page-dark: "#141518"
  surface-soft: "#f3f3ef"
  surface-soft-dark: "#1b1c20"
  surface-raised: "#ffffff"
  surface-raised-dark: "#1f2126"
  ink: "#1b1b1a"
  ink-dark: "#ecebe6"
  ink-learner: "#1d4fc4"
  ink-learner-dark: "#8fb0ff"
  ink-marker: "#d8433a"
  ink-marker-dark: "#ff6a5e"
  ink-marker-text: "#b8352c"
  ink-marker-text-dark: "#ff6a5e"
  pencil: "#63635e"
  pencil-dark: "#a3a39c"
  rule: "#d3dfee"
  rule-dark: "#262a33"
  rule-strong: "#b9c6da"
  rule-strong-dark: "#363b47"
  accent-strong: "#1d4fc4"
  accent-strong-dark: "#3b63d6"
  accent-hover: "#173fa0"
  accent-hover-dark: "#a9c2ff"
  accent-soft: "#e6ecfa"
  accent-soft-dark: "rgba(143, 176, 255, 0.14)"
  accent-ring: "rgba(29, 79, 196, 0.35)"
  accent-ring-dark: "rgba(143, 176, 255, 0.45)"
  text-on-accent: "#ffffff"
  signal-success: "#1f7a3f"
  signal-success-dark: "#5fcf8a"
  signal-warning: "#8a5a00"
  signal-warning-dark: "#e6b450"
typography:
  display:
    fontFamily: "Familjen Grotesk, system-ui, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Familjen Grotesk, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Familjen Grotesk, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: "28px"
    letterSpacing: "-0.01em"
  subhead:
    fontFamily: "Familjen Grotesk, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: "28px"
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: "28px"
    letterSpacing: "normal"
  contents:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: "28px"
    letterSpacing: "normal"
  caption:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "28px"
    letterSpacing: "normal"
  label:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: "28px"
    letterSpacing: "normal"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: "28px"
    letterSpacing: "normal"
rounded:
  page: "0"
  control: "4px"
spacing:
  space-1: "0.25rem"
  space-2: "0.5rem"
  space-3: "0.75rem"
  space-4: "1rem"
  space-5: "1.5rem"
  half-pitch: "14px"
  pitch: "28px"
components:
  button-filled:
    backgroundColor: "{colors.accent-strong}"
    textColor: "{colors.text-on-accent}"
    typography: "{typography.caption}"
    rounded: "{rounded.control}"
    padding: "0.5rem 1.25rem"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.ink-learner}"
    typography: "{typography.caption}"
    rounded: "{rounded.page}"
    padding: "0"
  button-text-disabled:
    backgroundColor: "transparent"
    textColor: "{colors.pencil}"
    typography: "{typography.caption}"
    rounded: "{rounded.page}"
    padding: "0"
  button-icon:
    backgroundColor: "transparent"
    textColor: "{colors.ink-learner}"
    rounded: "{rounded.control}"
    width: "2rem"
    height: "{spacing.pitch}"
  field-on-rule:
    backgroundColor: "transparent"
    textColor: "{colors.ink-learner}"
    typography: "{typography.body}"
    rounded: "{rounded.page}"
    padding: "0"
  field-boxed:
    backgroundColor: "{colors.page}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
  status-caption:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.caption}"
    rounded: "{rounded.control}"
    padding: "0.25rem 0.75rem"
  ruled-box:
    backgroundColor: "{colors.page}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.page}"
    padding: "13px 1rem"
  contents-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.contents}"
    rounded: "{rounded.page}"
    padding: "0 0.25rem 0 0.75rem"
  contents-row-hover:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.ink}"
  cue-entry:
    backgroundColor: "transparent"
    textColor: "{colors.ink-learner}"
    typography: "{typography.body}"
    rounded: "{rounded.page}"
    padding: "0"
  note-turn:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.page}"
    padding: "28px 0 0"
  summary-strip:
    backgroundColor: "{colors.page}"
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    rounded: "{rounded.page}"
    padding: "14px 0 0"
  overlay:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0.5rem 1.5rem 1.25rem"
---

# Design System: Crux

## Overview

**Creative North Star: "The Cornell Page"**

The session is one Cornell note page, and the page is the product's memory made visible. The tutor writes in the notes column; what the tutor knows about you lives in the cue column beside it; the summary strip at the foot closes the sheet. There is no bubble stream, no avatar per row, and no profile hidden behind a drawer. Structure comes from rules, columns and ink, never from cards, fills or shadows. The sidebar is the notebook's contents page: session rows on ruled lines, the current one in bold.

The page is white notebook paper, not cream, with feint blue rules at a 28px pitch behind every line of notes and one 2px red margin rule dividing cue from notes. Three inks each own one role and nothing else: graphite is the tutor and all body text; blue ballpoint is the learner (your messages, your cue words, your answers, every control, link and focus ring); red pen is the margin rule and the marker's marks. Pencil grey carries dates, counts and hints. The dark theme is the same desk with the lamp off: same rules, same three roles, inks re-tuned so every text ink still clears 4.5:1 (the token contrast test asserts this on both blocks of base.css).

Motion is ink appearing. A new cue writes itself into the column left to right (clip-path reveal, 320ms), grading draws a red tick or cross as a stroke (stroke-dashoffset, 240ms), routes fade in (160ms opacity). Nothing slides, bounces or scales; reduced motion shows the final state.

**Key Characteristics:**
- Ruled ground: a 28px line pitch behind the notes, every text block a whole multiple of it.
- Three inks with fixed roles (graphite tutor, blue learner, red marker) plus pencil for asides.
- No cards, no bubbles, no avatars, no eyebrow labels, no icon tiles; rules and columns carry structure.
- Paper does not float: shadows only on teleported overlays (dialog, toast, row menu, mobile drawer).
- Controls are written, not stamped: the default button is a line of blue text; the filled blue button is reserved for dialog footers and the skip link.
- Marks are drawn strokes (tick, cross, focus dash, level stroke at five weights), never glyph fonts.

## Colors

A white page, three inks and a pencil; the palette is a stationery drawer, not a brand ramp.

### Primary
- **Blue Ballpoint** (`ink-learner`, light #1d4fc4 / dark #8fb0ff): the learner's ink. Learner turns, the "you" gutter tag, cue words, answer letters, links, text buttons, icon buttons, the composer caret and text, the focus ring, the blue mastered tick. This is the only interactive colour on the page.
- **Blue Fill** (`accent-strong`, light #1d4fc4 / dark #3b63d6): the filled control. Dark theme uses a deeper blue than the dark learner ink so white label text (`text-on-accent`) clears AA; never fill with `ink-learner` directly.
- **Blue Hover** (`accent-hover`): the hover shift for links and blue text.
- **Blue Wash** (`accent-soft`): text selection only.
- **Blue Ring** (`accent-ring`, 35% light / 45% dark): the softer focus ring used inside the notes column.

### Secondary
- **Red Pen, mark** (`ink-marker`, light #d8433a / dark #ff6a5e): the margin rule, the focus underline under a cue word, the grading tick and cross, alert borders on a status caption. A drawn mark only; it does not clear 4.5:1 on paper and is excluded from the contrast test for that reason.
- **Red Pen, text** (`ink-marker-text`, light #b8352c / dark #ff6a5e): the text-safe red. "Not quite", the recap score, the stop control, the near-limit character count, failed-upload copy, the destructive confirm fill (#b8352c with white label in both themes). In the dark theme the two reds are the same value.

### Neutral
- **Graphite** (`ink`, light #1b1b1a / dark #ecebe6): the tutor and all body text, headings, cue section headings, the border of a ruled box, the summary strip's closing rule.
- **Pencil** (`pencil`, light #63635e / dark #a3a39c): dates, counts, hints, role tags ("tutor", "check"), placeholders, footnotes, disabled text, the unset level stroke, the gap circle mark.
- **Page** (`page`, light #fcfcfa / dark #141518): the ground of everything, including the sidebar, header and ruled boxes.
- **Soft Surface** (`surface-soft`): code fences, inline code, sidebar row hover, overlay item hover. The only tonal fill on the page.
- **Raised Surface** (`surface-raised`): overlays only (dialogs, toasts, row menu).
- **Feint Rule** (`rule`, light #d3dfee / dark #262a33): the ruled ground, painted option separators, the hairline under an answer line.
- **Strong Rule** (`rule-strong`, light #b9c6da / dark #363b47): borders that structure the page: header underline, notes-foot rule, sidebar edge and section rules, code fence border, table cells, footnote rule, the composer line at rest, scrollbar thumbs, skeleton bars.

### Signals
- **Ready Green** (`signal-success`) and **Warning Ochre** (`signal-warning`): AA-tested, and on the anchor used only as the border of a status caption whose file is ready. They never set text and never fill. (The contract named three inks; the build kept a fourth for the ready edge.)

### Named Rules
**The Three Inks Rule.** Graphite is the tutor and body. Blue is the learner and every control, link and focus ring. Red is the margin rule and the marker's marks. Nothing else may use blue or red; a new surface that wants a third accent has read the wrong page.

**The Marked, Never Set Rule.** A cue under focus or under test stays in graphite and is underlined in red (2px, offset 4px). Red text exists (`ink-marker-text`) only for verdicts, scores, errors and the stop control.

**The Pencil Aside Rule.** Anything that is a note about the page rather than the page itself (date, count, hint, role tag, footnote, "none yet") is pencil.

## Typography

**Display Font:** Familjen Grotesk 600 (with system-ui, sans-serif), self-hosted variable 400-700
**Body Font:** Atkinson Hyperlegible Next (with system-ui, sans-serif), self-hosted variable 200-800, used at 400 / 700
**Label/Mono Font:** JetBrains Mono (with ui-monospace, monospace), code only

**Character:** A hyperlegible reading face for hours of notes, a compact grotesk for the one line that names the page, and a mono that appears only inside a fence. No tracked labels, no uppercase, no eyebrows; a heading carries its own weight at normal tracking.

### Hierarchy
- **Display** (600, 2.25rem, 1.15): the not-found sheet's title. Reserved for a page that has no header strip.
- **Headline** (600, 1.75rem, 1.15, -0.01em): the session topic in the 72px page header; drops to 1.375rem under 900px.
- **Title** (600, 1.375rem, 28px): the recap score, the summary strip's "Session ended" line, dialog headers.
- **Subhead** (600, 1.125rem, 28px): headings inside a tutor turn (all markdown h1-h4 collapse to this).
- **Body** (400, 1.0625rem, 28px): notes, cue words, options, the composer. Bold (700) for a check question, a verdict, a section heading. Measure is 72ch beside a 4rem gutter.
- **Contents** (400, 0.9375rem, 28px): the sidebar's own size for session rows, search, the new-session line, menu items; current row at 700.
- **Caption** (400, 0.875rem, 28px): header meta, cue section headings (700), status captions, text buttons (700), footnote-adjacent copy, the recap's gap name.
- **Label** (400, 0.8125rem, 28px): gutter role tags, composer hints, citations, the three-cell label on session rows, code fence header.
- **Mono** (400, 0.9375rem in fences, 0.9em inline, 28px): code only.

### Named Rules
**The Pitch Rule.** Every line of text in the notes column, cue column, sidebar list and status slot has `line-height: 28px` (`--line-pitch`), including captions and labels, so that everything sits on the rules. A block whose height is intrinsic (display math, a fence, a table, an image) is topped up to the next whole pitch by the `--snap-pad` snapper in MarkdownContent.

**The One Display Line Rule.** Familjen Grotesk appears once per sheet as the headline, and otherwise only at title size for a closing line, a score or an overlay header. Body copy, cues and controls are never set in the display face.

## Layout

The app shell is a two-column grid: the sidebar (16rem expanded, 3rem collapsed, sticky, full height, a 1px strong rule down its right edge) and the page. Sheet routes (`route.meta.sheet`) escape the 72rem centred `.page-inner` measure and run edge to edge; the document is locked and the notes column is the only scroller.

The sheet is a grid of `232px / 2px / minmax(0, 1fr)` with a 72px header row spanning all three columns. The header holds the headline on the left and, on the right in pencil, "started ..." and the level stroke; a 1px strong rule under it. The cue column is sticky and scrolls independently, sections stacked one pitch apart (Focus, Gaps, Mastered, Level). The 2px red margin rule fills the middle column for the full sheet height. The notes column paints `--ruled-bg` (a repeating gradient, 1px of `rule` at the foot of every 28px box) with `background-attachment: local` so the rules scroll with the text.

Inside the notes column, every turn is a two-column row: a 4rem gutter for the role tag, then the text at a maximum of `4rem + 72ch`. Turns are separated by one pitch of top padding, never by margins that could collapse. The notes foot (check box, consent box, status slot, composer or summary strip) sits under a 1px strong rule with 0.75rem gaps and one pitch of bottom padding.

Ruled offset: the rule paints at the foot of each box but the baseline sits 7.32px above it at 17px, so every consumer of `--ruled-bg` also sets `background-position-y: var(--ruled-offset)` (-7px). Where a laid-out 1px border would make a line 29px, the rule is painted instead (`box-shadow: inset 0 -1px 0`), or the line-height is reduced by the border (`calc(var(--line-pitch) - 1px)`); a fence and a ruled box use `13px + 1px border` for half a pitch of frame at each end.

Breakpoints: under 900px the cue column becomes a one-line strip under the header (focus cue, gap count, mastered count, a disclosure chevron) that expands in place, the margin rule is hidden, and the header drops to 0.75rem padding with the title at 1.375rem. Under 600px the 4rem gutter collapses and the role tag sits above the text; the composer hint is hidden. The sidebar becomes a 3rem top strip (menu, wordmark, settings) and a drawer that fades in over a 45% graphite backdrop.

Spacing is the pitch and whole 4px multiples: 0.25 / 0.5 / 0.75 / 1 / 1.25 / 1.5rem for gaps and insets, 28px and 14px for anything that must stay on the rules. The `--space-*` scale in base.css is used only by the library view; the anchor does not consume it.

## Elevation & Depth

Paper does not float. The page, sidebar, header, ruled boxes and status captions are all flat on the same ground; depth comes from rule weight (feint, strong, ink) and from ink weight (pencil, graphite, bold). `--shadow-paper` is `none` by definition. The single shadow token, `--shadow-lift` (`0 12px 24px -12px rgba(0,0,0,0.25)`, 0.7 alpha in dark), is reserved for surfaces that are literally lifted off the page: PrimeVue dialogs and confirm, toasts, the sidebar row menu popover, and the mobile drawer.

### Shadow Vocabulary
- **Lift** (`box-shadow: 0 12px 24px -12px rgba(0, 0, 0, 0.25)`; dark `rgba(0, 0, 0, 0.7)`): teleported or absolutely positioned overlays only, always with a 1px strong-rule border and `surface-raised` background.

### Named Rules
**The Paper Does Not Float Rule.** No element that is part of the page carries a shadow, a raised surface or a hover lift. If it needs a shadow, it is an overlay; if it is not an overlay, draw a rule.

**The Painted Rule Rule.** A 1px separator inside a pitch-aligned block is painted with an inset box-shadow, never laid out as a border, so the line stays 28px.

## Shapes

The page has no radius: sheet, header, sidebar, ruled boxes, composer line, session rows, turn rows and the summary strip are all square. Controls that need a hit target (icon buttons, the skip link, fields, status captions, overlays, code fences, inline code, scrollbar thumbs) use one radius, 4px. There is no pill, no circle and no large radius on the anchor; the typing indicator's 5px dots and the gap mark's circle are drawn marks, not shapes.

Borders are the form language: 1px `rule-strong` for page structure, 1px `ink` for a ruled box or the summary strip's closing rule, 2px `margin-rule` red for the one vertical divider, a 2px red underline for a marked cue, a 2px graphite underline for the active status tab. Marks are stroked SVG paths with round caps at 1.5px (ticks, circles, chevrons, attach and send) or 2px (red marks); the level mark is one diagonal stroke `M2 17 L22 7` at five weights (0.75 / 1.5 / 2.25 / 3 / 3.75), pencil when unset.

## Components

### Buttons
Written, not stamped. The default action in this world is a line of blue text.
- **Text button** (the default): transparent, no border, no padding, caption size at 700 in `ink-learner`, underlined with a 3px offset, `line-height: 28px`. Used for Skip, Next, Done, Retry, Resume, Review my gaps, View all, New session, load earlier. Disabled: pencil, no underline, no pointer. Focus: 2px `accent-ring` outline, offset 2px (sidebar variants use solid `ink-learner`).
- **Filled blue button**: `accent-strong` fill, white label, 600 weight, 4px radius, `0.5rem 1.25rem`. Dialog footers and the skip link only. Destructive confirm: `#b8352c` fill, `#94271f` on hover, white label.
- **Icon button**: a drawn 20px SVG stroke (1.5px, round caps) in `ink-learner`, 2rem wide by one pitch tall, transparent, 4px radius. Attach, send, stop (stop in `ink-marker-text`), the cue disclosure, the consent dismiss. Disabled: pencil.
- **Hover:** blue text gains an underline or shifts to `accent-hover`; nothing moves or lifts.

### Sheet
The session page: header strip, cue column, margin rule, notes column, foot. Grid `232px / 2px / 1fr` over rows `auto / 1fr`; `body.chat-locked` holds the document to the viewport so the notes column is the only scroller. Any route that wants the ruled ground and edge-to-edge width sets `meta.sheet` and adopts this grid.

### Cue Column
What the tutor knows, as cue words. Four sections one pitch apart, each with a bold caption-size graphite heading (Focus, Gaps, Mastered, Level). Entries are body size on the pitch with a drawn mark and 0.5rem gap: focus is a red 2px dash and the word in graphite with a red underline; a gap is a pencil circle and the word in blue; mastered is a blue tick and the word in blue; the cue under an open check takes the red underline. Empty sections say "no focus cue yet" / "none open" / "none yet" in pencil. Level is the diagonal stroke at its weight beside the level word in pencil, with subtopic strokes listed under it. A newly recorded cue lands with a 320ms clip-path reveal; below 900px the column is a strip (focus, "N gaps", "N mastered", chevron) that expands in place.

### Ruled Notes
Turns on the rules. A tutor turn: gutter tag "tutor" in pencil label size, text in graphite; markdown paragraphs and lists carry a 28px bottom margin, headings 28px top, blockquotes are set in 1.5em and pencil italic. A learner turn: gutter tag "you" and text both in `ink-learner`. No bubble, no avatar, no background. A landed tick (blue, drawn in 240ms) hangs under "tutor" on the latest turn that changed the profile. Tool activity is a pencil aside (a 12px dash and text), citations are a footnote block under a strong rule in pencil label size with superscript refs. Code fences: `surface-soft` fill, 1px strong rule, 4px radius, 13px + 1px frame, mono 0.9375rem, a pencil header row with a "copy" outline button one pitch tall. Display math is followed by a painted strong rule and topped up to the pitch.

### Gutter Role Tag
The 4rem gutter before every turn, check and skeleton row holds one word at label size on the pitch: "tutor" and "check" in pencil, "you" in blue. It is a flex column so the tag carries only its own strut. Under 600px it becomes a row above the text.

### Ruled Box (checks and the consent card)
A check pauses the page. A 1px graphite border, page background over the rules, no radius, `13px + 1px` vertical frame and 1rem sides, spanning the notes measure beside a "check" gutter tag. The question is body 700 graphite; options are full-width transparent buttons one pitch tall with a painted feint rule underneath, a blue 700 letter ("A.") and graphite text; hover underlines the text. Grading draws a red tick on the correct line and a red cross on a wrong pick (2px stroke, 240ms), the wrong text goes pencil, the verdict reads "Correct" in graphite or "Not quite" in text-safe red, and the explanation appears only once graded. Skip / Next / Done are text buttons; "2/3" progress is a pencil label at the foot right. The diagnostic consent card is the same box with a Q. / A. / B. / C. option list.

### Check Recap
The marked-up sheet inside a tutor turn: a one-pitch header with the score in title size, text-safe red, beside the gap name in pencil caption, a painted strong rule under it; then each question with its options, the correct one ticked in red and tagged "correct", the learner's wrong pick in blue struck through in red and tagged "your answer"; explanations in pencil.

### Status Caption
One line of ink on paper inside a full 1px rule, 4px radius, `0.25rem 0.75rem`, caption size on the pitch. At rest the rule is `rule-strong`; an alert (cap reached, send error, failed upload) uses `ink-marker` for the rule with a text-safe red lead; a ready file uses `signal-success` for the rule. It lands with the 320ms clip-path reveal, one caption at a time in the status slot (upload outranks follow-up), and leaves clean. The PrimeVue toast is the same caption lifted: raised surface, strong rule, no severity tint, no coloured edge, body 700 summary with pencil detail, same reveal.

### Contents Row (sidebar sessions)
A ruled line on the contents page. Transparent, no radius, one pitch minimum, `0 0.25rem 0 0.75rem`; line one is the topic at contents size in graphite with the mastered count in pencil label size on the right; line two, when present, is the focus cue at label size in graphite with the red 2px underline. Current row is 700, nothing else marks it; ended rows go pencil; hover and focus-within fill the row with `surface-soft` and reveal the pencil ellipsis menu trigger. Collapsed rail: a 1rem by 2px pencil stroke, blue for the current row, strong-rule for ended. The three-cell label (SessionChips) is focus / level / mastered at label size with drawn marks: focus in graphite with a red dash, level in pencil with the graphite stroke, mastered in pencil with a blue tick; the level cell is owed on session rows until Issue #289.

### Contents Page (sidebar shell)
Page background, 1px strong rule on the right, the wordmark (page mark: an outlined page with a red margin line and three feint rules) at the top. New session is a blue text line with a drawn plus; Review is a blue line with a pencil count at the right; search is a field on a rule; Active / Ended are two blue caption-700 toggles, the one in force in graphite with a 2px graphite underline. The list paints the ruled ground with the same offset. Settings sits in a footer under a strong rule.

### Summary Strip
The sheet closes under a 1px graphite rule. Half a pitch of top padding, then "Session ended 3 days ago." in title size graphite, the summary in body graphite, the keep-as-is note in pencil caption, and Review my gaps / Resume topic as text buttons 1.25rem apart. It reads as a completed sheet, not a locked one.

### Inputs / Fields
- **Field on a rule** (composer, sidebar search, row rename): transparent, no border except a 1px `rule-strong` bottom rule, no padding, body size on the pitch, text and caret in `ink-learner`, placeholder in pencil; on focus-within the rule turns `ink-learner` (rename thickens to 2px). The composer is a three-column line, attach on the left, send or stop on the right, a Skip text button while a check is open, and pencil label hints beneath ("Enter to send, Shift + Enter for a new line", the count turning text-safe red at 90% of 4000).
- **Boxed field** (PrimeVue InputText / Textarea / Select in overlays and forms): page background, 1px `rule-strong` border, 4px radius, body size, blue caret; focus is a blue border plus a 2px blue outline at 1px offset, no glow. Placeholder in pencil.
- **Error:** copy in text-safe red on its own pitch line; no red fill.

### Navigation
Text links in `ink-learner`, 1px underline at 3px offset, `accent-hover` on hover; the session topic in the header is a link that gains a 2px red underline on hover and opens the profile. The back control is a blue caption-700 line with an arrow. Route changes fade in over 160ms, no leave phase.

### Overlays (Dialog, ConfirmDialog, row menu)
Raised surface, 1px strong rule, 4px radius, lift shadow. Dialog header in the display face at title size, content at body, footer under a feint rule with the filled blue button. Menu items one pitch tall at contents size, pencil glyph, `surface-soft` on hover, End session in text-safe red with a 10% red wash on hover. Gap picker entries are cue words on ruled lines (pencil circle, blue word), not boxed options.

### Skeletons and Empty States
Pencil-weight bars: 1px `rule-strong` lines on the pitch in the turn geometry, no shimmer. The empty sheet shows three feint rules, a prompt line in graphite and three quick prompts as blue text lines.

### Page Mark
An outlined page (1px current-colour stroke, 2px corner) with a 2px red margin line and three `rule-strong` note lines; the wordmark "Crux" in the display face at 600 beside it. 22 / 28 / 56px sizes.

## Do's and Don'ts

### Do:
- **Do** set every line in a ruled area to `line-height: 28px` and keep every block a whole multiple of the pitch; paint a separator (`inset 0 -1px 0`) or subtract it from the line-height rather than adding a border.
- **Do** pair `background-image: var(--ruled-bg)` with `background-position-y: var(--ruled-offset)` and `background-attachment: local` on every ruled scroller.
- **Do** make the default action a blue text line (caption, 700, underline offset 3px) and reserve the filled blue button for dialog footers and the skip link.
- **Do** draw marks as stroked SVG paths (1.5px round caps; 2px for red) and animate them with stroke-dashoffset over 240ms; reveal new ink with `clip-path: inset(0 100% 0 0)` to `inset(0)` over 320ms on `cubic-bezier(0.16, 1, 0.3, 1)`.
- **Do** use `accent-strong` (not `ink-learner`) behind white text, and keep every new text ink in base.css so tokenContrast.test.js asserts it in both themes.
- **Do** carry the three-cell label (focus / level / mastered) on every session row and card, with the focus cue in graphite under a red underline.
- **Do** keep test hooks (data-testid, aria attributes, asserted class names, copy strings) unchanged when extending a surface.

### Don't:
- **Don't** put a card, bubble, avatar, icon tile or shadow on the page; shadows belong to teleported overlays only.
- **Don't** set text in `ink-marker`; use `ink-marker-text`, and use red only for the margin rule, marks, underlines and verdicts.
- **Don't** add eyebrow or kicker labels, uppercase tracked labels, or a second accent colour.
- **Don't** slide, scale or bounce anything; motion is opacity, clip-path or a stroke draw, and reduced motion shows the final state.
- **Don't** round the page: 0 on sheets, rows, boxes and strips; 4px only on hit targets, fields, captions and overlays.
- **Don't** fill a hover; underline it or shift to `accent-hover`. The only hover fill is `surface-soft` on a contents row or overlay item.
- **Don't** mix glyph icon fonts into a surface built in this world; use drawn SVG strokes.
