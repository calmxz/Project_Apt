# Test Hooks for Phase B Redesign (Chat Surface)

**Report date:** 2026-09-10  
**Scope:** in-scope components for visual redesign in Phase B  
**Purpose:** List every CSS class selector, literal string, and aria attribute that tests depend on, so the redesign knows which hooks it must keep or which tests must change.

---

## In-Scope Components

- SessionView.vue
- Components in frontend/src/components/chat/: AssistantBubble, UserBubble, MessageList, MessageListSkeleton, CheckQuestion, CheckRecap, Composer, SessionHeader, EmptyState, ReferenceStatusBanner, UploadStatus, CapBanners, CitationsList, ToolCallChip, MarkdownContent
- SessionEndedBanner.vue
- DiagnosticConsentCard.vue
- GapPickerDialog.vue
- SessionChips.vue
- sidebar/*.vue

---

## Table 1: CSS Class Selectors by Component

Each class listed below is directly referenced in test selectors (e.g., `.find('.class-name')`), class assertions (e.g., `.classes().toContain('class-name')`), or Playwright locators. Tests will fail if these classes are renamed or removed.

| Component | CSS Class Selector |
|-----------|------------------|
| AssistantBubble | .assistant |
| AssistantBubble | .cancelled-marker |
| AssistantBubble | .content |
| AssistantBubble | .msg |
| AssistantBubble | .role-tag |
| AssistantBubble | .streaming |
| AssistantBubble | .tool-call-row |
| chat (e2e) | .cancelled-marker |
| CheckRecap | .is-correct |
| CheckRecap | .is-incorrect |
| CitationsList | .citation-doc |
| CitationsList | .citation-pages |
| Composer | .composer-count |
| EmptyState | .archived-empty |
| EmptyState | .empty-eyebrow |
| EmptyState | .empty-line |
| EmptyState | .empty-spark |
| GapPickerDialog | .crux-dialog |
| MessageList | .message-list |
| MessageListSkeleton | .msg-skel-row |
| SessionChips | .chip |
| SessionChips | .chip-glyph |
| SessionChips | .chip-text |
| SessionChips | .sr-only |
| SessionView | .crux-dialog |
| SessionView | .error-details |
| sidebar | .sb-brand |
| sidebar | .sb-rail--column |
| sidebar | .sb-row--current |
| sidebar | .sb-row--ended |
| sidebar | .sb-session-list--collapsed [data-session-id] |
| sidebar | .sb-skel-list |
| sidebar | .sb-toggle--end |
| UserBubble | .msg |
| UserBubble | .role-tag |
| UserBubble | .user |

**Total CSS class selectors:** 36 across 11 components

---

## Table 2: Literal Copy Strings in Test Assertions

These exact strings are asserted in tests via `.toContain()`, `.toBe()`, `.toMatch()`, or `.toContainText()`. If UI copy changes, tests must be updated.

| Component | Literal String | Test File | Line |
|-----------|----------------|-----------|------|
| AssistantBubble | `<strong>bold</strong>` | assistantBubble.test.js | 11 |
| AssistantBubble | Found 5 passages | assistantBubble.test.js | 26 |
| AssistantBubble | Doc | assistantBubble.test.js | 39 |
| AssistantBubble | p.1 | assistantBubble.test.js | 40 |
| AssistantBubble | (interrupted) | assistantBubble.test.js | 59 |
| AssistantBubble | msg-streaming | assistantBubble.test.js | 79 |
| AssistantBubble | msg-assistant | assistantBubble.test.js | 91 |
| AssistantBubble | tutor | assistantBubble.test.js | 107 |
| AssistantBubble | Could not ask questions | assistantBubble.test.js | 151 |
| AssistantBubble | safe | assistantBubble.test.js | 173 |
| AssistantBubble | Nice work! | assistantBubble.test.js | 220 |
| chat (e2e) | stopped | chat-stream.spec.js | 65 |
| CheckQuestion | 1/2 | checkQuestion.test.js | 38 |
| CheckQuestion | status | checkQuestion.test.js | 153 |
| CheckQuestion | polite | checkQuestion.test.js | 154 |
| CheckQuestion | true | checkQuestion.test.js | 155 |
| CheckRecap | PFK-1 catalyzes the committed step. | checkRecap.test.js | 61 |
| CitationsList | <!--v-if--> | citationsList.test.js | 8 |
| CitationsList | Algorithms Chapter 3 | citationsList.test.js | 20 |
| CitationsList | p.42 | citationsList.test.js | 21 |
| CitationsList | p.44 | citationsList.test.js | 22 |
| CitationsList | A | citationsList.test.js | 37 |
| CitationsList | p.1 | citationsList.test.js | 38 |
| CitationsList | p.3 | citationsList.test.js | 39 |
| CitationsList | fallback-id | citationsList.test.js | 46 |
| CitationsList | algo-ch3 | citationsList.test.js | 54 |
| CitationsList | p. | citationsList.test.js | 55 |
| Composer | new text | composer.test.js | 102 |
| daily-cap (e2e) | Daily limit reached | daily-cap.spec.js | 49 |
| EmptyState | begin | chatEmptyState.test.js | 14 |
| EmptyState | Where should I start with this topic? | chatEmptyState.test.js | 36 |
| EmptyState | archive | chatEmptyState.test.js | 65 |
| MessageListSkeleton | true | messageListSkeleton.test.js | 11 |
| onboarding-to-chat (e2e) | [STUB:fresh] | onboarding-to-chat.spec.js | 47 |
| onboarding-to-chat (e2e) | what is recursion? | onboarding-to-chat.spec.js | 48 |
| ReferenceStatusBanner | confirm-delete-strong | referenceStatusBanner.test.js | 124 |
| ReferenceStatusBanner | p-button-secondary | referenceStatusBanner.test.js | 126 |
| ReferenceStatusBanner | p-button-danger | referenceStatusBanner.test.js | 127 |
| resume-carries-profile (e2e) | [STUB:resumed: | resume-carries-profile.spec.js | 84 |
| SessionChips | Focus: | sessionChips.test.js | 12 |
| SessionChips | ATP yield | sessionChips.test.js | 13 |
| SessionChips | 3 | sessionChips.test.js | 23 |
| SessionChips | mastered | sessionChips.test.js | 24 |
| SessionChips | true | sessionChips.test.js | 31 |
| SessionEndedBanner | GMT | sessionEndedBanner.test.js | 14 |
| SessionEndedBanner | Read-only | sessionEndedBanner.test.js | 15 |
| SessionEndedBanner | Continue the topic in a new session | sessionEndedBanner.test.js | 16 |
| SessionHeader | Glycolysis pathway | sessionHeader.test.js | 15 |
| SessionHeader | /session/s1/profile | sessionHeader.test.js | 22 |
| SessionView | Calculus | sessionView.test.js | 137 |
| SessionView | Thermodynamics | sessionView.test.js | 215 |
| SessionView | precious text | sessionView.test.js | 408 |
| SessionView | file content does not match its extension | sessionView.test.js | 885 |
| SessionView | too large | sessionView.test.js | 905 |
| SessionView | cap-banner-daily | sessionView.test.js | 937 |
| SessionView | Daily message limit reached | sessionView.test.js | 984 |
| SessionView | status | sessionView.test.js | 985 |
| SessionView | streaming text | sessionView.test.js | 1004 |
| SessionView | polite | sessionView.test.js | 1019 |
| SessionView | Tutor is replying. | sessionView.test.js | 1024 |
| SessionView | Reply finished. | sessionView.test.js | 1028 |
| sidebar | No sessions yet | sidebar.test.js | 79 |
| sidebar | 1 | sidebar.test.js | 115 |
| sidebar | page | sidebar.test.js | 179 |
| sidebar | Glycolysis | sidebar.test.js | 197 |
| sidebar | This week | sidebar.test.js | 275 |
| sidebar | Older | sidebar.test.js | 276 |
| sidebar | 9 | sidebar.test.js | 462 |
| sidebar | group | sidebar.test.js | 703 |
| sidebar | Review | sidebar.test.js | 1161 |
| sidebar | 13 | sidebar.test.js | 1162 |
| sidebar | new | sidebar.test.js | 1226 |
| sidebar | old | sidebar.test.js | 1285 |
| sidebar | Collapse sidebar | sidebar.test.js | 1311 |
| sidebar | Expand sidebar | sidebar.test.js | 1321 |
| sidebar | View all 28 sessions | sidebar.test.js | 1391 |
| UserBubble | Hi there | userBubble.test.js | 8 |
| UserBubble | <strong>bold</strong> | userBubble.test.js | 13 |
| UserBubble | msg-user | userBubble.test.js | 24 |
| UserBubble | you | userBubble.test.js | 29 |

**Total string assertions:** 86 across 11 components + e2e

---

## Table 3: ARIA Attributes Referenced in Tests

These ARIA attributes are tested for presence or specific values. Removing or changing attribute names will break accessibility tests.

| Component | ARIA Attribute |
|-----------|----------------|
| CheckQuestion | aria-atomic |
| CheckQuestion | aria-disabled |
| CheckQuestion | aria-live |
| CheckQuestion | role |
| MessageList | aria-atomic |
| MessageListSkeleton | aria-hidden |
| SessionChips | aria-hidden |
| SessionView | aria-describedby |
| SessionView | aria-live |
| SessionView | role |
| sidebar | aria-current |
| sidebar | aria-haspopup |
| sidebar | aria-label |
| sidebar | aria-pressed |
| sidebar | role |

**Total aria attributes:** 15 across 6 components

---

## Summary

- **36** CSS class selectors across 11 components (redesign-critical)
- **86** literal copy strings across 11 components + e2e (copy-change-sensitive)
- **15** ARIA attributes across 6 components (a11y-critical)

**Design requirement:** Keep or explicitly migrate all CSS class selectors listed in Table 1. For copy strings, update test assertions where UI copy intentionally changes. For ARIA attributes, verify no attributes are removed or renamed without updating tests.
