<template>
  <section class="new-session">
    <div class="hero">
      <span class="folio">begin</span>
      <h1 class="hero-title">What do you want to learn?</h1>
      <p class="hero-lede">
        Type one topic. The tutor adapts to what you already know and where you get stuck.
      </p>
    </div>

    <div class="form">
      <div class="field">
        <label for="topic" class="sr-only">Topic</label>
        <input
          id="topic"
          v-model="topic"
          class="topic-input"
          data-testid="new-topic"
          placeholder="e.g. Recursion, the Krebs cycle, French passé composé…"
          autocomplete="off"
          @keydown.enter="onEnter"
        />
        <p class="help">
          To continue an ended topic, use "Continue topic" on its card in the
          Sessions library — the tutor keeps your profile. Reopening from the
          sidebar picks up the same session instead.
        </p>
      </div>

      <div class="quick-picks" aria-label="Quick topic ideas">
        <button
          v-for="pick in quickPicks"
          :key="pick"
          type="button"
          class="quick-pick"
          @click="setTopic(pick)"
        >
          {{ pick }}
        </button>
      </div>

      <div class="attach">
        <input
          ref="fileInputEl"
          type="file"
          :accept="ACCEPT_ATTR"
          multiple
          data-testid="new-file-input"
          hidden
          @change="onFilesPicked"
        />
        <button type="button" class="attach-btn" data-testid="new-file-add" @click="openFilePicker">
          <i class="pi pi-paperclip" aria-hidden="true" />
          <span>Add reference files (optional)</span>
        </button>
        <p class="attach-hint">PDF, PPTX, TXT, or MD. The tutor can cite these during the session.</p>

        <ul v-if="files.length" class="chips" aria-label="Attached files">
          <li v-for="(f, i) in files" :key="`${f.name}-${i}`" class="chip" data-testid="new-file-chip">
            <i class="pi pi-file" aria-hidden="true" />
            <span class="chip-name">{{ f.name }}</span>
            <button
              type="button"
              class="chip-remove"
              :aria-label="`Remove ${f.name}`"
              @click="removeFile(i)"
            >
              <i class="pi pi-times" aria-hidden="true" />
            </button>
          </li>
        </ul>

        <div aria-live="polite" aria-atomic="true">
          <p v-if="fileErrors.length" class="file-errors" data-testid="new-file-errors">
            {{ fileErrors.join(' ') }}
          </p>
        </div>
      </div>

      <div
        v-if="activeOnTopic"
        class="warn"
        data-testid="new-active-warn"
      >
        <i class="pi pi-info-circle warn-icon" aria-hidden="true" />
        <div class="warn-body">
          <p class="warn-line">
            You already have an active session on
            <strong>"{{ activeOnTopic.topic }}"</strong>
            (#{{ shortId(activeOnTopic.id) }}, started {{ formatRelative(activeOnTopic.created_at) }}).
          </p>
          <button
            type="button"
            class="warn-action"
            data-testid="new-open-existing"
            @click="openExisting"
          >
            <span>Open existing</span>
            <i class="pi pi-arrow-right" aria-hidden="true" />
          </button>
        </div>
      </div>

      <p v-if="error" class="error" data-testid="new-error">{{ error }}</p>

      <button
        v-if="existingSessionId"
        type="button"
        class="open-existing"
        data-testid="open-existing-session"
        @click="router.push({ name: 'session', params: { id: existingSessionId } })"
      >
        Open existing session
      </button>

      <button
        type="button"
        class="cta-primary"
        data-testid="new-submit"
        :disabled="!canSubmit || store.loading || uploadingFiles || dupeBlocked"
        @click="submit"
      >
        <span>{{ submitLabel }}</span>
        <i class="pi pi-arrow-right" aria-hidden="true" />
      </button>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { ACCEPT_ATTR, uploadDocument, validateFile } from '../services/uploadApi.js'
import { useSessionStore } from '../stores/session.js'
import { findActiveSessionByTopic, formatRelative, shortId } from '../utils/formatDate.js'

const router = useRouter()
const store = useSessionStore()

const topic = ref('')
const error = ref(null)
const existingSessionId = ref(null)

const files = ref([])
const fileErrors = ref([])
const uploadingFiles = ref(false)
const fileInputEl = ref(null)

const quickPicks = [
  'Recursion',
  'CSS grid',
  'Photosynthesis',
  'Big-O notation',
  'French verbs',
  'World War II',
]

onMounted(async () => {
  if (!store.sessions.length) {
    await store.listSessions().catch(() => {})
  }
})

const activeOnTopic = computed(() =>
  findActiveSessionByTopic(store.sessions, topic.value),
)

const dupeBlocked = computed(() => Boolean(activeOnTopic.value))
const canSubmit = computed(() => Boolean(topic.value.trim()))

const submitLabel = computed(() => {
  if (uploadingFiles.value) {
    return `Uploading ${files.value.length} file${files.value.length === 1 ? '' : 's'}...`
  }
  if (store.loading) return 'Creating...'
  return 'Create session'
})

function setTopic(value) {
  topic.value = value
}

function onEnter() {
  if (canSubmit.value && !store.loading && !uploadingFiles.value && !dupeBlocked.value) submit()
}

function openExisting() {
  if (!activeOnTopic.value) return
  router.push({ name: 'session', params: { id: activeOnTopic.value.id } })
}

function openFilePicker() {
  fileInputEl.value?.click()
}

function onFilesPicked(event) {
  fileErrors.value = []
  for (const f of Array.from(event.target.files || [])) {
    const v = validateFile(f)
    if (v.ok) files.value.push(f)
    else fileErrors.value.push(v.reason)
  }
  event.target.value = ''
}

function removeFile(i) {
  files.value.splice(i, 1)
}

async function submit() {
  error.value = null
  existingSessionId.value = null
  if (dupeBlocked.value) {
    error.value = 'An active session for this topic already exists.'
    return
  }
  let created
  try {
    created = await store.createSession({
      topic: topic.value.trim(),
      seedMode: 'fresh',
      priorSessionId: null,
    })
  } catch (e) {
    if (e?.status === 409 && e?.body?.detail?.code === 'duplicate_topic') {
      existingSessionId.value = e.body.detail.session_id
      error.value = 'An active session for this topic already exists.'
      return
    }
    error.value = e?.message || 'Failed to create session.'
    return
  }
  if (files.value.length) {
    uploadingFiles.value = true
    const results = await Promise.allSettled(
      files.value.map((file) => uploadDocument({ sessionId: created.id, file })),
    )
    uploadingFiles.value = false
    const failed = results.filter((r) => r.status === 'rejected').length
    if (failed) {
      fileErrors.value = [`${failed} file(s) failed to upload. You can retry from the session.`]
    }
  }
  router.push({ name: 'session', params: { id: created.id } })
}
</script>

<style scoped>
.new-session {
  max-width: 42rem;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.625rem;
  margin-top: 1.5rem;
}

.folio {
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  font-weight: 600;
  color: var(--color-accent-text);
}

.hero-title {
  font-family: var(--font-display);
  font-size: clamp(2rem, 5vw, 2.875rem);
  font-weight: 700;
  letter-spacing: var(--tracking-display);
  line-height: 1.05;
  color: var(--color-heading);
  margin: 0;
}

.hero-lede {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 1.0625rem;
  max-width: 34rem;
  line-height: var(--lh-body);
}

.form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
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

.topic-input {
  display: block;
  width: 100%;
  padding: 1.125rem 1.5rem;
  border-radius: var(--radius-pill);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  color: var(--color-heading);
  font-family: var(--font-display);
  font-size: 1.25rem;
  font-weight: 500;
  letter-spacing: var(--tracking-tight);
  box-shadow: var(--shadow-paper);
  transition: border-color var(--motion-fast) ease, box-shadow var(--motion-fast) ease, transform var(--motion-fast) ease;
}

.topic-input::placeholder {
  color: var(--color-text-faint);
  font-weight: 400;
}

.topic-input:hover {
  border-color: var(--color-border-strong);
}

.topic-input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 4px var(--color-accent-ring);
}

.help {
  margin: 0 0 0 1.5rem;
  color: var(--color-text-muted);
  font-size: 0.8125rem;
}

.quick-picks {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  padding: 0 0.5rem;
}

.quick-pick {
  padding: 0.4rem 0.875rem;
  border-radius: var(--radius-pill);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-family: var(--font-sans);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: background var(--motion-fast) ease, color var(--motion-fast) ease, border-color var(--motion-fast) ease, transform var(--motion-fast) ease;
}

.quick-pick:hover {
  background: var(--color-accent-soft);
  color: var(--color-accent-text);
  border-color: var(--color-accent-soft);
  transform: translateY(-1px);
}

.quick-pick:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.attach {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.attach-btn {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 1rem;
  border-radius: var(--radius-pill);
  background: var(--color-surface);
  border: 1px dashed var(--color-border-strong);
  color: var(--color-text-muted);
  font-family: var(--font-sans);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: border-color var(--motion-fast) ease, color var(--motion-fast) ease;
}

.attach-btn:hover,
.attach-btn:focus-visible {
  border-color: var(--color-accent);
  color: var(--color-accent-text);
}

.attach-btn:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.attach-hint {
  margin: 0 0 0 0.25rem;
  color: var(--color-text-muted);
  font-size: 0.8125rem;
}

.chips {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.4rem 0.35rem 0.7rem;
  border-radius: var(--radius-pill);
  background: var(--color-accent-soft);
  color: var(--color-accent-text);
  font-size: 0.8125rem;
}

.chip-name {
  max-width: 14rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chip-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--color-accent-text);
  cursor: pointer;
}

.chip-remove:hover,
.chip-remove:focus-visible {
  background: var(--color-surface);
}

.file-errors {
  margin: 0;
  color: var(--color-error-text);
  font-size: 0.8125rem;
}

.warn {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 1rem 1.125rem;
  border-radius: var(--radius-lg);
  background: rgba(91, 141, 239, 0.1);
  border: 1px solid rgba(91, 141, 239, 0.3);
}

.warn-icon {
  color: var(--signal-info);
  font-size: 1.25rem;
  margin-top: 0.125rem;
  flex-shrink: 0;
}

.warn-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  align-items: flex-start;
}

.warn-line {
  margin: 0;
  color: var(--color-text);
  font-size: 0.9375rem;
  line-height: 1.5;
}

.warn-line strong {
  color: var(--color-heading);
  font-weight: 600;
}

.warn-action {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.4rem 0.875rem;
  border-radius: var(--radius-pill);
  background: var(--signal-info);
  color: #FFFFFF;
  border: 0;
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 0.8125rem;
  cursor: pointer;
  transition: filter var(--motion-fast) ease, transform var(--motion-fast) var(--motion-bounce);
}

.warn-action:hover {
  filter: brightness(1.08);
  transform: translateY(-1px);
}

.error {
  margin: 0;
  color: var(--color-error-text);
  font-size: 0.9375rem;
}

.open-existing {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.4rem 0.875rem;
  border-radius: var(--radius-pill);
  background: var(--signal-info);
  color: #FFFFFF;
  border: 0;
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 0.8125rem;
  cursor: pointer;
  transition: filter var(--motion-fast) ease, transform var(--motion-fast) var(--motion-bounce);
}

.open-existing:hover {
  filter: brightness(1.08);
  transform: translateY(-1px);
}

.cta-primary {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.9rem 1.625rem;
  border-radius: var(--radius-pill);
  background: var(--color-accent-strong);
  color: #FFFFFF;
  border: 0;
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 1rem;
  cursor: pointer;
  box-shadow: var(--shadow-pop);
  transition: transform var(--motion-fast) var(--motion-bounce), box-shadow var(--motion-fast) ease, opacity var(--motion-fast) ease;
}

.cta-primary:hover:not(:disabled) {
  transform: translateY(-2px);
}

.cta-primary:active:not(:disabled) {
  transform: translateY(4px);
  box-shadow: var(--shadow-pop-pressed);
}

.cta-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  box-shadow: none;
}

.cta-primary:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 3px;
}
</style>
