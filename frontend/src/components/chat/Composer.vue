<template>
  <div class="composer-wrap">
    <input
      ref="fileInputEl"
      type="file"
      accept="application/pdf"
      data-testid="session-upload-input"
      hidden
      @change="onFileChange"
    />

    <div class="composer" :class="{ 'is-disabled': disabled }">
      <button
        type="button"
        class="composer-attach"
        data-testid="session-upload-btn"
        :disabled="disabled || uploading || locked"
        :aria-label="uploading ? 'Uploading PDF' : 'Attach a PDF'"
        :title="uploading ? 'Uploading…' : 'Attach PDF'"
        @click="openFilePicker"
      >
        <i v-if="!uploading" class="pi pi-paperclip" aria-hidden="true" />
        <i v-else class="pi pi-spin pi-spinner" aria-hidden="true" />
      </button>

      <textarea
        ref="composerEl"
        :value="modelValue"
        data-testid="session-input"
        class="composer-input"
        rows="1"
        :placeholder="placeholder"
        :disabled="disabled"
        :maxlength="MAX_DRAFT_LEN"
        :aria-describedby="describedby || undefined"
        @input="onInput"
        @keydown="onKeydown"
      />

      <button
        v-if="streamState === 'idle'"
        type="button"
        class="composer-send"
        data-testid="session-send"
        :disabled="disabled || !modelValue.trim() || sending"
        :aria-label="sending ? 'Sending message' : 'Send message'"
        @click="emit('send')"
      >
        <i
          :class="sending ? 'pi pi-spin pi-spinner' : 'pi pi-arrow-up'"
          aria-hidden="true"
        />
      </button>

      <button
        v-else
        type="button"
        class="composer-stop"
        data-testid="session-stop"
        :disabled="streamState === 'stopping'"
        aria-label="Stop generating"
        @click="emit('stop')"
      >
        <i class="pi pi-stop" aria-hidden="true" />
      </button>

      <button
        v-if="locked"
        type="button"
        class="composer-skip"
        data-testid="composer-skip"
        aria-label="Skip this question"
        @click="emit('skip')"
      >
        Skip
      </button>
    </div>

    <div class="composer-hints" :class="{ 'is-near-limit': nearCharLimit }">
      <span class="composer-hint">
        <kbd aria-label="Enter"><span aria-hidden="true">⏎</span></kbd> to send
        <span class="composer-hint-sep" aria-hidden="true">·</span>
        <kbd aria-label="Shift"><span aria-hidden="true">⇧</span></kbd>+<kbd aria-label="Enter"><span aria-hidden="true">⏎</span></kbd> newline
      </span>
      <span v-if="modelValue.length" class="composer-count" aria-live="polite">
        {{ modelValue.length.toLocaleString() }} / {{ MAX_DRAFT_LEN.toLocaleString() }}
      </span>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  uploading: { type: Boolean, default: false },
  sending: { type: Boolean, default: false },
  streamState: { type: String, default: 'idle' },
  // id(s) of an element explaining why the composer is disabled (e.g. the active
  // cap banner). Wired to aria-describedby so SR users hear the reason on focus.
  describedby: { type: String, default: null },
  // When true, a check-question is active: show answer placeholder + Skip button,
  // disable attach.
  locked: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue', 'send', 'stop', 'attach', 'skip'])

const composerEl = ref(null)
const fileInputEl = ref(null)

const MAX_DRAFT_LEN = 2000
const COMPOSER_MAX_HEIGHT_PX = 220

const nearCharLimit = computed(() => props.modelValue.length >= MAX_DRAFT_LEN * 0.9)

const placeholder = computed(() =>
  props.locked
    ? 'Pick an answer above, or Skip...'
    : 'Ask anything. Press Enter to send · Shift + Enter for a new line.',
)

function autoResize() {
  const inner = composerEl.value
  if (!inner) return
  inner.style.height = 'auto'
  const next = Math.min(inner.scrollHeight, COMPOSER_MAX_HEIGHT_PX)
  inner.style.height = `${next}px`
}

watch(
  () => props.modelValue,
  () => nextTick(autoResize),
)

function onInput(e) {
  emit('update:modelValue', e.target.value)
  autoResize()
}

function onKeydown(ev) {
  if (
    ev.key === 'Enter' &&
    !ev.shiftKey &&
    !ev.isComposing &&
    props.streamState === 'idle' &&
    !props.disabled &&
    props.modelValue.trim() &&
    !props.sending
  ) {
    ev.preventDefault()
    emit('send')
  }
}

function openFilePicker() {
  fileInputEl.value?.click()
}

function onFileChange(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (file) {
    emit('attach', file)
  }
}

function focus() {
  const el = composerEl.value
  if (el) {
    el.focus()
    autoResize()
  }
}

defineExpose({ focus })
</script>

<style scoped>
/* Composer — native textarea + icon buttons in a CSS grid. Replaced the
   previous PrimeVue Textarea + Button because Aura's tokens were bleeding
   through the wrapper and breaking the layout (white box overflowing the
   dark pill). Owning the markup gives us deterministic styling. */
.composer-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.composer {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: end;
  gap: 0.5rem;
  padding: 0.55rem 0.55rem 0.55rem 0.6rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lift);
  transition:
    border-color var(--motion-fast) ease,
    box-shadow var(--motion-base) ease,
    transform var(--motion-base) var(--motion-bounce);
}

.composer:focus-within {
  border-color: var(--color-accent);
  box-shadow:
    var(--shadow-lift),
    0 0 0 4px var(--color-accent-ring);
  transform: translateY(-1px);
}

.composer.is-disabled {
  opacity: 0.7;
}

.composer-input {
  grid-column: 2;
  align-self: stretch;
  width: 100%;
  min-height: 2.5rem;
  max-height: 220px;
  padding: 0.625rem 0.25rem;
  margin: 0;
  background: transparent;
  border: 0;
  outline: 0;
  resize: none;
  overflow-y: auto;

  font-family: var(--font-sans);
  font-size: 1rem;
  line-height: 1.5;
  color: var(--color-text);
  caret-color: var(--color-accent);

  scrollbar-width: thin;
  scrollbar-color: var(--color-border-strong) transparent;
}

.composer-input::placeholder {
  color: var(--color-text-faint);
  opacity: 1;
}

.composer-input:disabled {
  cursor: not-allowed;
}

.composer-input::-webkit-scrollbar { width: 8px; }
.composer-input::-webkit-scrollbar-button { display: none; height: 0; width: 0; }
.composer-input::-webkit-scrollbar-track { background: transparent; }
.composer-input::-webkit-scrollbar-thumb {
  background: var(--color-border-strong);
  border-radius: var(--radius-pill);
  border: 2px solid transparent;
  background-clip: padding-box;
}
.composer-input::-webkit-scrollbar-thumb:hover { background: var(--color-text-faint); }

/* Attach, send, and stop share the round-icon vocabulary. Sizes intentionally
   identical so the composer reads as balanced book-ends around the input. */
.composer-attach,
.composer-send,
.composer-stop {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  flex-shrink: 0;
  border-radius: var(--radius-pill);
  font-size: 1rem;
  cursor: pointer;
  transition:
    background var(--motion-fast) ease,
    color var(--motion-fast) ease,
    border-color var(--motion-fast) ease,
    transform var(--motion-fast) var(--motion-bounce),
    box-shadow var(--motion-fast) ease,
    opacity var(--motion-fast) ease;
}

.composer-attach {
  grid-column: 1;
  align-self: end;
  margin-bottom: 0.1rem;
  background: transparent;
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
}

.composer-attach:hover:not(:disabled),
.composer-attach:focus-visible {
  background: var(--color-accent-soft);
  border-color: var(--color-accent-soft);
  color: var(--color-accent);
}

.composer-attach:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.composer-attach:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.composer-send {
  grid-column: 3;
  align-self: end;
  margin-bottom: 0.1rem;
  background: var(--color-accent-strong);
  color: #FFFFFF;
  border: 0;
  box-shadow: var(--shadow-pop);
  font-weight: 600;
}

.composer-send:not(:disabled):hover,
.composer-send:not(:disabled):focus-visible {
  transform: translateY(-2px);
}

.composer-send:not(:disabled):focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.composer-send:not(:disabled):active {
  transform: translateY(3px);
  box-shadow: var(--shadow-pop-pressed);
}

.composer-send:disabled {
  background: var(--color-surface-soft);
  color: var(--color-text-faint);
  box-shadow: none;
  cursor: not-allowed;
}

/* Stop button — occupies the same slot as Send (grid-column 3).
   Uses signal-error to communicate "danger/halt" clearly. */
.composer-stop {
  grid-column: 3;
  align-self: end;
  margin-bottom: 0.1rem;
  background: var(--signal-error);
  color: #FFFFFF;
  border: 0;
  box-shadow: var(--shadow-pop);
  font-weight: 600;
}

.composer-stop:not(:disabled):hover,
.composer-stop:not(:disabled):focus-visible {
  transform: translateY(-2px);
  filter: brightness(1.08);
}

.composer-stop:not(:disabled):focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.composer-stop:not(:disabled):active {
  transform: translateY(3px);
  box-shadow: var(--shadow-pop-pressed);
}

.composer-stop:disabled {
  background: var(--color-surface-soft);
  color: var(--color-text-faint);
  box-shadow: none;
  cursor: not-allowed;
}

/* Footer hint strip — keyboard cheatsheet left, character count right.
   Mono caption styling keeps it editorial without competing with the input. */
.composer-hints {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0 0.5rem;
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  letter-spacing: 0.04em;
  color: var(--color-text-faint);
  user-select: none;
}

.composer-hint {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.composer-hint kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.25rem;
  height: 1.25rem;
  padding: 0 0.3rem;
  border: 1px solid var(--color-border);
  border-bottom-width: 2px;
  border-radius: 4px;
  background: var(--color-surface-soft);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  color: var(--color-text-muted);
  line-height: 1;
}

.composer-hint-sep {
  color: var(--color-border-strong);
}

.composer-count {
  font-variant-numeric: tabular-nums;
  transition: color var(--motion-fast) ease;
}

.composer-hints.is-near-limit .composer-count {
  color: var(--signal-warning);
  font-weight: 600;
}

.composer-skip {
  grid-column: 3;
  align-self: end;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  color: var(--color-text-muted);
  padding: 0 0.75rem;
  height: 2.5rem;
  font-size: 0.8125rem;
  cursor: pointer;
  transition:
    border-color var(--motion-fast) ease,
    color var(--motion-fast) ease;
}

.composer-skip:hover,
.composer-skip:focus-visible {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.composer-skip:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

@media (max-width: 600px) {
  .composer-hints { display: none; }
  .composer-attach,
  .composer-send,
  .composer-stop {
    width: 2.25rem;
    height: 2.25rem;
  }
}
</style>
