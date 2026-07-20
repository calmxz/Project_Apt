import { describe, it, expect } from 'vitest'
import { buildCspContent, cspPlugin } from '../../cspPlugin.js'

describe('csp plugin', () => {
  it('derives connect-src from an absolute API base', () => {
    const csp = buildCspContent('https://crux-api.onrender.com/api')
    expect(csp).toContain("connect-src 'self' https://*.supabase.co https://crux-api.onrender.com")
  })
  it('relative API base collapses to self + supabase', () => {
    const csp = buildCspContent('/api')
    expect(csp).toContain("connect-src 'self' https://*.supabase.co;")
  })
  it('injects a meta tag into index html', () => {
    const html = '<html><head><title>Crux</title></head><body></body></html>'
    const out = cspPlugin('https://x.example/api').transformIndexHtml(html)
    expect(out).toContain('http-equiv="Content-Security-Policy"')
  })
  it('throws a clear build-time error instead of silently skipping injection when the </title> anchor is missing', () => {
    const html = '<html><head></head><body></body></html>'
    expect(() => cspPlugin('https://x.example/api').transformIndexHtml(html)).toThrow(
      /crux-csp-meta/,
    )
  })
})
