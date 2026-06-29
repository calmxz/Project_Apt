<script setup>
defineOptions({ name: 'SidebarSubjectNode' })

import { computed, ref } from 'vue'
import { useSubjectStore } from '@/stores/subject.js'
import SidebarSessionRow from './SidebarSessionRow.vue'

const props = defineProps({
  subject: { type: Object, required: true },
})

const subjectStore = useSubjectStore()
const expanded = ref(false)
const loaded = ref(false)

// Lessons that have an opened session (session_id set).
const openedLessons = computed(() => {
  if (!expanded.value) return []
  const lessons = subjectStore.currentSubject?.lessons || []
  return lessons.filter((l) => l.session_id)
})

async function toggle() {
  expanded.value = !expanded.value
  if (expanded.value && !loaded.value) {
    loaded.value = true
    await subjectStore.loadSubject(props.subject.id)
  }
}

function toSession(lesson) {
  return { id: lesson.session_id, topic: lesson.title, ended_at: null }
}

</script>

<template>
  <div
    :data-testid="`sidebar-subject-node-${subject.id}`"
    class="sb-subject-node"
  >
    <button
      type="button"
      :data-testid="`sidebar-subject-toggle-${subject.id}`"
      class="sb-subject-toggle"
      :aria-expanded="expanded"
      @click="toggle"
    >
      <i
        :class="expanded ? 'pi pi-chevron-down' : 'pi pi-chevron-right'"
        aria-hidden="true"
        class="sb-subject-chevron"
      />
      <span class="sb-subject-title">{{ subject.title }}</span>
      <span
        :data-testid="`sidebar-subject-progress-${subject.id}`"
        class="sb-section-count"
      >{{ subject.progress.done_count }}/{{ subject.progress.total_count }}</span>
    </button>
    <ul v-if="expanded && openedLessons.length" class="sb-session-list sb-subject-lessons">
      <SidebarSessionRow
        v-for="lesson in openedLessons"
        :key="lesson.id"
        :session="toSession(lesson)"
        state="active"
      />
    </ul>
  </div>
</template>

<style scoped>
.sb-subject-node {
  margin-bottom: 0.125rem;
}

.sb-subject-toggle {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  width: 100%;
  padding: 0.375rem 0.75rem;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  font-family: var(--font-sans);
  font-size: var(--fs-label);
  font-weight: 600;
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
  cursor: pointer;
  text-align: left;
  border-radius: var(--radius-md);
  transition: background var(--motion-fast) ease, color var(--motion-fast) ease;
}

.sb-subject-toggle:hover {
  background: var(--color-surface-soft);
  color: var(--color-text);
}

.sb-subject-toggle:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.sb-subject-chevron {
  font-size: 0.625rem;
  flex-shrink: 0;
}

.sb-subject-title {
  flex: 1;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sb-subject-lessons {
  padding-left: 0.75rem;
  list-style: none;
  margin: 0;
}

.sb-subject-lesson-row {
  position: relative;
}

.sb-lesson-status-chip {
  position: absolute;
  top: 0.375rem;
  right: 0.375rem;
  padding: 0.125rem 0.375rem;
  border-radius: var(--radius-pill);
  background: var(--color-surface-soft);
  color: var(--color-text-faint);
  font-family: var(--font-sans);
  font-size: var(--fs-caption);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  pointer-events: none;
}

.sb-lesson-status-chip[data-status='done'] {
  background: var(--color-accent-soft);
  color: var(--color-accent-text);
}
</style>
