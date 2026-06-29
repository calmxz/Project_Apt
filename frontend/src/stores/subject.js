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

  async function openLesson(lessonId) {
    const { session_id } = await subjectsApi.openLesson(lessonId)
    return session_id
  }

  async function markLessonDone(lessonId) {
    return patchLesson(lessonId, { status: 'done' })
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
    addLesson, patchLesson, deleteLesson, openLesson, markLessonDone, reset,
  }
})
