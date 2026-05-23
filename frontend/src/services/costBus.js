// EventTarget for X-Cost-Warning soft-cap notifications carried back on
// successful API responses. Parallel to errorBus — plain JS module so
// apiClient can dispatch without a Vue setup context. Listeners (toasts,
// banners) attach from within Vue components.
export const costBus = new EventTarget()

export function reportCostWarning(detail) {
  costBus.dispatchEvent(new CustomEvent('cost-warning', { detail }))
}
