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
            width="36"
            height="48"
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
          <svg v-else viewBox="0 0 36 48" width="36" height="48" focusable="false">
            <rect class="sw-page" x="0.5" y="0.5" width="35" height="47" />
            <path class="sw-margin" d="M9 4 L9 44" />
            <path class="sw-rule" d="M13 14 L31 14" />
            <path class="sw-rule" d="M13 22 L31 22" />
            <path class="sw-rule" d="M13 30 L31 30" />
          </svg>
        </span>
        <span class="mode-line">
          <span class="mode-label">{{ opt.label }}</span>
          <svg
            v-if="override === opt.value"
            class="mode-tick"
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
  gap: 1.5rem;
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
   values are lifted verbatim from DESIGN.md's palette and are the one place
   in this surface where a literal ink is correct. The system swatch cannot
   be drawn from the live tokens either -- that would just mirror whichever
   theme happens to be active -- so it is drawn as half light page, half dark
   page, literally split down the middle. */
.mode-swatch {
  display: inline-flex;
}

.mode-swatch--light {
  --sw-page: #fcfcfa;
  --sw-ink: #b9c6da;
  --sw-rule: #d3dfee;
  --sw-margin: #d8433a;
}

.mode-swatch--dark {
  --sw-page: #141518;
  --sw-ink: #363b47;
  --sw-rule: #262a33;
  --sw-margin: #ff6a5e;
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
  fill: #fcfcfa;
}

.sw-page--dk {
  fill: #141518;
}

.sw-frame {
  stroke: #b9c6da;
  stroke-width: 1;
}

.sw-margin--lt {
  stroke: #d8433a;
}

.sw-rule--lt {
  stroke: #d3dfee;
}

.sw-rule--dk {
  stroke: #262a33;
}

.mode-line {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
}

.mode-label {
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  line-height: var(--line-pitch);
  color: var(--ink);
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
  fill: none;
  stroke: var(--ink-learner);
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
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
