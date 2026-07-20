// I-06: vercel.json headers cannot interpolate env vars, so a committed CSP
// either ships a placeholder (broken deploys, the CRUX_API_HOST landmine) or
// a hardcoded host (breaks previews/forks). Inject the policy at build time
// from VITE_API_BASE_URL instead, as a meta tag. frame-ancestors cannot live
// in a meta CSP - clickjacking stays covered by the X-Frame-Options header
// that remains in vercel.json/nginx.
export function buildCspContent(apiBase) {
  let apiOrigin
  try {
    apiOrigin = apiBase ? new URL(apiBase).origin : ''
  } catch {
    apiOrigin = '' // relative base (/api): same-origin, 'self' covers it
  }
  const connect = ["'self'", 'https://*.supabase.co', apiOrigin].filter(Boolean).join(' ')
  return [
    "default-src 'self'",
    `connect-src ${connect}`,
    "img-src 'self' data:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ') + ';'
}

export function cspPlugin(apiBase) {
  return {
    name: 'crux-csp-meta',
    apply: 'build', // dev server needs HMR websockets a strict CSP would block
    transformIndexHtml(html) {
      const meta = `<meta http-equiv="Content-Security-Policy" content="${buildCspContent(apiBase)}">`
      return html.replace('</title>', `</title>\n    ${meta}`)
    },
  }
}
