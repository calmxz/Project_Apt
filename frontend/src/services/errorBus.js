// EventTarget so apiClient (plain JS) can fan errors out to App.vue, which
// holds the Vue setup context required by useToast(). Plain modules can't call
// useToast(), and a Pinia middleware would miss any caller that doesn't route
// through a store.
export const errorBus = new EventTarget()

export function reportApiError(err) {
  errorBus.dispatchEvent(new CustomEvent('api-error', { detail: err }))
}
