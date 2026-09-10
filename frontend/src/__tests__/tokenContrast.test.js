import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/* global process */
// Pure file read; vitest root is frontend/, so cwd-relative is stable in jsdom too.
const css = readFileSync(resolve(process.cwd(), 'src/assets/base.css'), 'utf8')

function hex(varName, block) {
  const re = new RegExp(`${varName}:\\s*(#[0-9a-fA-F]{6})`, 'g')
  const matches = [...block.matchAll(re)].map((m) => m[1])
  if (!matches.length) throw new Error(`token ${varName} not found`)
  return matches
}
function lum(h) {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const l = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]
}
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)

describe('base.css tokens', () => {
  it('dark --color-text-faint on --color-background is >= 4.5:1 in every dark block', () => {
    const dark = css.slice(css.indexOf("[data-theme='dark']"))
    const bgs = hex('--color-background', dark)
    const faints = hex('--color-text-faint', dark)
    expect(faints.length).toBe(bgs.length)
    faints.forEach((f, i) => expect(ratio(f, bgs[i])).toBeGreaterThanOrEqual(4.5))
  })
})
