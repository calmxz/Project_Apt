import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import * as subjectsApi from '../services/subjectsApi.js'
import { friendlyError } from '../lib/errors.js'

export const useSubjectStore = defineStore('subject', () => {
  const subjects = ref([])
  const currentSubject = ref(null)
  const loading = ref(false)
  const error = ref(null)

  function _setError(e) {
    error.value = friendlyError(e)
    throw e
  }

  const nextLesson = computed(() => {
    const lessons = currentSubject.value?.lessons || []
    return lessons.find((l) => l.status !== 'done') || null
  })

  async function listSubjects() {
    loading.value = true
    error.value = null
    try {
      subjects.value = await subjectsApi.listSubjects()
      return subjects.value
    } catch (e) {
      _setError(e)
    } finally {
      loading.value = false
    }
  }

  async function loadSubject(id) {
    loading.value = true
    error.value = null
    try {
      currentSubject.value = await subjectsApi.getSubject(id)
      return currentSubject.value
    } catch (e) {
      _setError(e)
    } finally {
      loading.value = false
    }
  }

  async function draftPlan(payload) {
    loading.value = true
    error.value = null
    try {
      const resp = await subjectsApi.draftPlan(payload)
      return resp?.lessons || []
    } catch (e) {
      _setError(e)
    } finally {
      loading.value = false
    }
  }

  async function createSubject(payload) {
    loading.value = true
    error.value = null
    try {
      const created = await subjectsApi.createSubject(payload)
      // Reflect the new subject in the sidebar immediately. The sidebar renders
      // from `subjects` (bootstrapped once on mount), so without this the node
      // does not appear until a full reload. POST /subjects returns a
      // SubjectDetail, a superset of the SubjectListItem shape the node reads
      // (id, title, progress), so it slots in directly.
      if (created) subjects.value = [created, ...subjects.value]
      return created
    } catch (e) {
      _setError(e)
    } finally {
      loading.value = false
    }
  }

  // Keep the sidebar's subjects list-item progress in step with currentSubject's
  // lessons after an in-place lesson mutation. The sidebar node reads
  // subjects[].progress, which loadSubject does not touch, so without this the
  // n/m count lags (e.g. stays 0/1 after a mark-done) until a full reload.
  function _syncSubjectListProgress() {
    const cs = currentSubject.value
    if (!cs) return
    const item = subjects.value.find((s) => s.id === cs.id)
    if (!item) return
    const lessons = cs.lessons || []
    item.progress = {
      done_count: lessons.filter((l) => l.status === 'done').length,
      total_count: lessons.length,
    }
  }

  async function addLesson(subjectId, lesson) {
    const created = await subjectsApi.addLesson(subjectId, lesson)
    if (currentSubject.value?.id === subjectId) {
      currentSubject.value.lessons = [...(currentSubject.value.lessons || []), created]
      _syncSubjectListProgress()
    }
    return created
  }

  async function patchLesson(lessonId, patch) {
    const updated = await subjectsApi.patchLesson(lessonId, patch)
    const lessons = currentSubject.value?.lessons || []
    const idx = lessons.findIndex((l) => l.id === lessonId)
    if (idx !== -1) {
      lessons[idx] = { ...lessons[idx], ...patch, ...updated }
      _syncSubjectListProgress()
    }
    return updated
  }

  async function deleteLesson(lessonId) {
    await subjectsApi.deleteLesson(lessonId)
    if (currentSubject.value?.lessons) {
      currentSubject.value.lessons = currentSubject.value.lessons.filter((l) => l.id !== lessonId)
      _syncSubjectListProgress()
    }
  }

  // Force-aware delete: without force, a lesson with session_id 409s on the server;
  // with force=true the backend ends the session + clears session_id + deletes in one
  // transaction. Local state is NOT mutated until the server confirms — a failed
  // delete leaves the plan intact. Changes lesson count -> sync sidebar progress.
  async function removeLesson(lessonId, { force = false } = {}) {
    await subjectsApi.deleteLesson(lessonId, { force })
    const lessons = currentSubject.value?.lessons || []
    const idx = lessons.findIndex((l) => l.id === lessonId)
    if (idx >= 0) {
      lessons.splice(idx, 1)
      const changed = _reindex(lessons)
      for (const l of changed) {
        await subjectsApi.patchLesson(l.id, { order_idx: l.order_idx })
      }
      _syncSubjectListProgress()
    }
  }

  async function openLesson(lessonId) {
    const { session_id } = await subjectsApi.openLesson(lessonId)
    return session_id
  }

  async function markLessonDone(lessonId) {
    return patchLesson(lessonId, { status: 'done' })
  }

  // Private helper: rewrite order_idx to contiguous 0-based sequence in-place.
  // Returns only the rows whose order_idx changed (callers PATCH those rows).
  // Kept as a named closure so Task 8 removeLesson can reuse it.
  function _reindex(lessons) {
    const changed = []
    lessons.forEach((l, i) => {
      if (l.order_idx !== i) {
        l.order_idx = i
        changed.push(l)
      }
    })
    return changed
  }

  // Insert a new lesson after the lesson at afterIdx, then reindex so
  // order_idx stays contiguous. Changes lesson count -> sync sidebar progress.
  //
  // OPTIMISTIC REORDER: local array mutation (splice + _reindex) happens before
  // the PATCH calls below. A failed order_idx PATCH leaves the server briefly
  // inconsistent but self-heals on the next loadSubject call. This is safe only
  // because Lesson has NO unique constraint on (subject_id, order_idx) — transient
  // overlapping indices during parallel PATCHes cannot raise a DB violation.
  // If a future migration adds that constraint, switch to sequential or
  // transactional reorder.
  async function addLessonAfter(subjectId, afterIdx, { title, goal }) {
    const lessons = currentSubject.value?.lessons || []
    const created = await subjectsApi.addLesson(subjectId, { title, goal })
    // Append at the end then splice into the target position
    lessons.push(created)
    const fromIdx = lessons.length - 1
    const toIdx = Math.min(afterIdx + 1, fromIdx)
    lessons.splice(fromIdx, 1)
    lessons.splice(toIdx, 0, created)
    const changed = _reindex(lessons)
    await Promise.all(changed.map((l) => subjectsApi.patchLesson(l.id, { order_idx: l.order_idx })))
    _syncSubjectListProgress()
    return created
  }

  // Move lessonId to toIdx (0-based target position), reindex, persist changed rows.
  //
  // OPTIMISTIC REORDER: local array mutation (splice + _reindex) happens before
  // the PATCH calls below. A failed order_idx PATCH leaves the server briefly
  // inconsistent but self-heals on the next loadSubject call. This is safe only
  // because Lesson has NO unique constraint on (subject_id, order_idx) — transient
  // overlapping indices during parallel PATCHes cannot raise a DB violation.
  // If a future migration adds that constraint, switch to sequential or
  // transactional reorder.
  async function moveLesson(lessonId, toIdx) {
    const lessons = currentSubject.value?.lessons || []
    const fromIdx = lessons.findIndex((l) => l.id === lessonId)
    if (fromIdx === -1 || toIdx < 0 || toIdx >= lessons.length || fromIdx === toIdx) return
    const [lesson] = lessons.splice(fromIdx, 1)
    lessons.splice(toIdx, 0, lesson)
    const changed = _reindex(lessons)
    await Promise.all(changed.map((l) => subjectsApi.patchLesson(l.id, { order_idx: l.order_idx })))
  }

  // Rename a lesson: patch title on server and update local state.
  async function renameLesson(lessonId, title) {
    await subjectsApi.patchLesson(lessonId, { title })
    const lessons = currentSubject.value?.lessons || []
    const lesson = lessons.find((l) => l.id === lessonId)
    if (lesson) lesson.title = title
  }

  // Edit a lesson's goal: patch goal on server and update local state.
  async function editLessonGoal(lessonId, goal) {
    await subjectsApi.patchLesson(lessonId, { goal })
    const lessons = currentSubject.value?.lessons || []
    const lesson = lessons.find((l) => l.id === lessonId)
    if (lesson) lesson.goal = goal
  }

  function reset() {
    subjects.value = []
    currentSubject.value = null
    error.value = null
  }

  return {
    subjects, currentSubject, loading, error,
    nextLesson,
    draftPlan, listSubjects, loadSubject, createSubject,
    addLesson, patchLesson, deleteLesson, removeLesson, openLesson, markLessonDone, reset,
    addLessonAfter, moveLesson, renameLesson, editLessonGoal,
  }
})
