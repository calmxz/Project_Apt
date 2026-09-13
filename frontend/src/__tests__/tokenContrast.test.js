import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/* global process */
// Pure file read; vitest root is frontend/, so cwd-relative is stable in jsdom too.
const css = readFileSync(resolve(process.cwd(), 'src/assets/base.css'), 'utf8')

const DARK_MARKER = "[data-theme='dark']"
const light = css.slice(0, css.indexOf(DARK_MARKER))
const dark = css.slice(css.indexOf(DARK_MARKER))

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

// Every ink that ever sets text, checked against the ground it sits on. The
// red mark (--ink-marker) is deliberately absent: it is a drawn mark only and
// does not clear 4.5:1 on paper, which is why --ink-marker-text exists.
const FOREGROUNDS = [
  '--color-text',
  '--color-text-muted',
  '--color-text-faint',
  '--color-accent-text',
  '--ink-marker-text',
  '--color-success-text',
  '--color-error-text',
  '--color-warning-text',
  '--color-info-text',
]

describe('base.css tokens', () => {
  for (const [themeName, block] of [
    ['light', light],
    ['dark', dark],
  ]) {
    it(`${themeName}: every text ink is >= 4.5:1 on --color-background in every block`, () => {
      const bgs = hex('--color-background', block)
      expect(bgs.length).toBeGreaterThan(0)
      for (const token of FOREGROUNDS) {
        const inks = hex(token, block)
        expect(inks.length, `${token} must be declared once per ${themeName} block`).toBe(
          bgs.length,
        )
        inks.forEach((ink, i) => {
          expect(
            ratio(ink, bgs[i]),
            `${token} on --color-background (${themeName})`,
          ).toBeGreaterThanOrEqual(4.5)
        })
      }
    })

    it(`${themeName}: --color-text-on-accent is >= 4.5:1 on --color-accent-strong`, () => {
      const fills = hex('--color-accent-strong', block)
      const labels = hex('--color-text-on-accent', block)
      expect(labels.length).toBe(fills.length)
      labels.forEach((label, i) => {
        expect(
          ratio(label, fills[i]),
          `filled control label (${themeName})`,
        ).toBeGreaterThanOrEqual(4.5)
      })
    })
  }
})
