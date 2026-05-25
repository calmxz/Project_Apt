// Wire one delegated click listener at a chat-container element. When a
// child .code-block-copy button is clicked, copy the sibling <code> text.
// Returns a teardown function.
export function attachCopyHandlers(rootEl) {
  function onClick(event) {
    const btn = event.target.closest('[data-copy-button]')
    if (!btn || !rootEl.contains(btn)) return
    const pre = btn.closest('pre.code-block')
    if (!pre) return
    const code = pre.querySelector('code')
    if (!code) return
    const text = code.textContent || ''
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        btn.textContent = 'copied'
        setTimeout(() => {
          btn.textContent = 'copy'
        }, 1500)
      })
      .catch(() => {
        btn.textContent = 'failed'
        setTimeout(() => {
          btn.textContent = 'copy'
        }, 1500)
      })
  }
  rootEl.addEventListener('click', onClick)
  return () => rootEl.removeEventListener('click', onClick)
}
