<template>
  <div class="composer-wrap">
    <input
      ref="fileInputEl"
      type="file"
      accept=".pdf,.pptx,.txt,.md"
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
        :aria-label="uploading ? 'Uploading file' : 'Attach a reference file'"
        :title="uploading ? 'Uploading...' : 'Attach a reference file (PDF, PPTX, TXT, MD)'"
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
        <i :class="sending ? 'pi pi-spin pi-spinner' : 'pi pi-arrow-up'" aria-hidden="true" />
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
      <span class="composer-hint">Enter to send, Shift + Enter for a new line</span>
      <span v-if="modelValue.length" class="composer-count" aria-live="polite" data-tabular>
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

// I-10: matches ChatRequest.message maxLength in the API contract.
const MAX_DRAFT_LEN = 4000
const COMPOSER_MAX_HEIGHT_PX = 224

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
/* One ruled line at the foot of the notes column: the learner writes on the
   rule in blue, the two drawn controls sit on either end. */
.composer-wrap {
  display: flex;
  flex-direction: column;
}

.composer {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: end;
  gap: 0.5rem;
  border-bottom: 1px solid var(--rule-strong);
  transition: border-color var(--motion-fast) ease;
}

.composer:focus-within {
  border-bottom-color: var(--ink-learner);
}

.composer.is-disabled {
  opacity: 0.7;
}

.composer-input {
  grid-column: 2;
  align-self: stretch;
  width: 100%;
  min-height: var(--line-pitch);
  max-height: 224px;
  padding: 0;
  margin: 0;
  background: transparent;
  border: 0;
  outline: 0;
  resize: none;
  overflow-y: auto;

  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--line-pitch);
  color: var(--ink-learner);
  caret-color: var(--ink-learner);

  scrollbar-width: thin;
  scrollbar-color: var(--rule-strong) transparent;
}

.composer-input::placeholder {
  color: var(--pencil);
  opacity: 1;
}

.composer-input:disabled {
  cursor: not-allowed;
}

.composer-input::-webkit-scrollbar {
  width: 8px;
}
.composer-input::-webkit-scrollbar-button {
  display: none;
  height: 0;
  width: 0;
}
.composer-input::-webkit-scrollbar-track {
  background: transparent;
}
.composer-input::-webkit-scrollbar-thumb {
  background: var(--rule-strong);
  border: 2px solid transparent;
  background-clip: padding-box;
}

/* Attach, send and stop are drawn icons in the learner's ink, not filled
   buttons: the line is the control, they are its ends. */
.composer-attach,
.composer-send,
.composer-stop {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: var(--line-pitch);
  flex-shrink: 0;
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  font-size: 1rem;
  color: var(--ink-learner);
  cursor: pointer;
  transition: color var(--motion-fast) ease;
}

.composer-attach {
  grid-column: 1;
  align-self: end;
}

.composer-send,
.composer-stop {
  grid-column: 3;
  align-self: end;
}

.composer-attach:focus-visible,
.composer-send:focus-visible,
.composer-stop:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.composer-stop {
  color: var(--ink-marker-text);
}

.composer-attach:disabled,
.composer-send:disabled,
.composer-stop:disabled {
  color: var(--pencil);
  cursor: not-allowed;
}

/* Hints in pencil under the line. */
.composer-hints {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  line-height: var(--line-pitch);
  color: var(--pencil);
  user-select: none;
}

.composer-count {
  transition: color var(--motion-fast) ease;
}

.composer-hints.is-near-limit .composer-count {
  color: var(--ink-marker-text);
  font-weight: 700;
}

.composer-skip {
  grid-column: 3;
  align-self: end;
  background: transparent;
  border: 0;
  padding: 0 0.5rem;
  height: var(--line-pitch);
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 700;
  color: var(--ink-learner);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.composer-skip:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

@media (max-width: 599px) {
  .composer-hint {
    display: none;
  }
}
</style>
