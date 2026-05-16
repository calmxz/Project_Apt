import { useToast as usePrimeToast } from 'primevue/usetoast'

// Thin wrapper over PrimeVue's useToast so call sites don't repeat the same
// boilerplate (severity, life, summary). Must be invoked inside a setup
// context — same constraint as PrimeVue's hook.
export function useToast() {
  const toast = usePrimeToast()

  const showError = (msg, { summary = 'Error', life = 6000 } = {}) =>
    toast.add({ severity: 'error', summary, detail: msg, life })

  const showWarn = (msg, { summary = 'Heads up', life = 5000 } = {}) =>
    toast.add({ severity: 'warn', summary, detail: msg, life })

  const showSuccess = (msg, { summary = 'Done', life = 3500 } = {}) =>
    toast.add({ severity: 'success', summary, detail: msg, life })

  return { showError, showWarn, showSuccess }
}
