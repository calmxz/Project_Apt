<template>
  <section class="appearance" data-testid="settings-appearance">
    <h2 class="heading">Appearance</h2>
    <p class="note">The same desk, with the lamp on or off.</p>

    <fieldset class="modes" data-testid="settings-theme-toggle">
      <legend class="sr-only">Theme</legend>
      <label
        v-for="opt in MODES"
        :key="opt.value"
        class="mode"
        :class="{ selected: override === opt.value }"
      >
        <input
          type="radio"
          class="mode-input"
          name="crux-theme"
          :value="opt.value"
          :checked="override === opt.value"
          :data-testid="`settings-theme-${opt.value}`"
          @change="setTheme(opt.value)"
        />
        <span :class="['mode-swatch', `mode-swatch--${opt.value}`]" aria-hidden="true">
          <svg
            v-if="opt.value === 'auto'"
            viewBox="0 0 36 48"
            width="72"
            height="96"
            focusable="false"
          >
            <rect class="sw-page sw-page--lt" x="0.5" y="0.5" width="17.5" height="47" />
            <rect class="sw-page sw-page--dk" x="18" y="0.5" width="17.5" height="47" />
            <rect class="sw-frame" x="0.5" y="0.5" width="35" height="47" fill="none" />
            <path class="sw-margin sw-margin--lt" d="M9 4 L9 44" />
            <path class="sw-rule sw-rule--lt" d="M13 14 L18 14" />
            <path class="sw-rule sw-rule--dk" d="M18 14 L31 14" />
            <path class="sw-rule sw-rule--lt" d="M13 22 L18 22" />
            <path class="sw-rule sw-rule--dk" d="M18 22 L31 22" />
            <path class="sw-rule sw-rule--lt" d="M13 30 L18 30" />
            <path class="sw-rule sw-rule--dk" d="M18 30 L31 30" />
          </svg>
          <svg v-else viewBox="0 0 36 48" width="72" height="96" focusable="false">
            <rect class="sw-page" x="0.5" y="0.5" width="35" height="47" />
            <path class="sw-margin" d="M9 4 L9 44" />
            <path class="sw-rule" d="M13 14 L31 14" />
            <path class="sw-rule" d="M13 22 L31 22" />
            <path class="sw-rule" d="M13 30 L31 30" />
          </svg>
        </span>
        <span class="mode-line">
          <span class="mode-label" :data-label="opt.label">{{ opt.label }}</span>
          <svg
            class="mode-tick"
            :class="{ 'mode-tick--on': override === opt.value }"
            viewBox="0 0 12 12"
            width="12"
            height="12"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M2 6.5 L4.8 9.2 L10 3.2" />
          </svg>
        </span>
      </label>
    </fieldset>
  </section>
</template>

<script setup>
import { useTheme } from '../../composables/useTheme.js'

const { override, setTheme } = useTheme()

const MODES = [
  { value: 'light', label: 'Lamp on' },
  { value: 'dark', label: 'Lamp off' },
  { value: 'auto', label: 'Match system' },
]
</script>

<style scoped>
.appearance {
  display: flex;
  flex-direction: column;
}

.heading {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  line-height: var(--line-pitch);
  color: var(--ink);
}

.note {
  margin: 0 0 var(--line-pitch);
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--line-pitch);
  color: var(--pencil);
}

.modes {
  display: flex;
  gap: 3rem;
  border: 0;
  padding: 0;
  margin: 0;
}

.mode {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  cursor: pointer;
}

.mode-input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

/* Each swatch is a page drawn in the inks of the theme it names, so the light
   page stays light while the app is dark. Theme tokens cascade from
   :root[data-theme], so they cannot express "the other theme" here: these
   values come from the theme-independent --sw-* tokens declared once in
   base.css's plain :root block (lifted verbatim from DESIGN.md's palette).
   The system swatch cannot be drawn from the live tokens either -- that
   would just mirror whichever theme happens to be active -- so it is drawn
   as half light page, half dark page, literally split down the middle. */
.mode-swatch {
  display: inline-flex;
}

.mode-swatch--light {
  --sw-page: var(--sw-light-paper);
  --sw-ink: var(--sw-light-ink);
  --sw-rule: var(--sw-light-rule);
  --sw-margin: var(--sw-light-margin);
}

.mode-swatch--dark {
  --sw-page: var(--sw-dark-paper);
  --sw-ink: var(--sw-dark-ink);
  --sw-rule: var(--sw-dark-rule);
  --sw-margin: var(--sw-dark-margin);
}

.sw-page {
  fill: var(--sw-page);
  stroke: var(--sw-ink);
  stroke-width: 1;
}

.sw-margin {
  stroke: var(--sw-margin);
  stroke-width: 2;
  stroke-linecap: round;
}

.sw-rule {
  stroke: var(--sw-rule);
  stroke-width: 1;
}

.sw-page--lt {
  fill: var(--sw-light-paper);
}

.sw-page--dk {
  fill: var(--sw-dark-paper);
}

.sw-frame {
  stroke: var(--sw-light-ink);
  stroke-width: 1;
}

.sw-margin--lt {
  stroke: var(--sw-light-margin);
}

.sw-rule--lt {
  stroke: var(--sw-light-rule);
}

.sw-rule--dk {
  stroke: var(--sw-dark-rule);
}

.mode-line {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
}

.mode-label {
  position: relative;
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--line-pitch);
  color: var(--ink);
}

/* Reserves the width the label would need at 700 weight, invisibly, so
   selecting a mode never widens its label and pushes its siblings. */
.mode-label::after {
  content: attr(data-label);
  display: block;
  height: 0;
  overflow: hidden;
  visibility: hidden;
  pointer-events: none;
  font-weight: 700;
}

.mode.selected .mode-label {
  font-weight: 700;
}

.mode:hover .mode-label {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.mode-tick {
  flex: 0 0 auto;
  visibility: hidden;
  fill: none;
  stroke: var(--ink-learner);
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.mode-tick--on {
  visibility: visible;
}

.mode:has(.mode-input:focus-visible) {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
