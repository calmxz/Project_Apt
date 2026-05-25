import { describe, it, expect } from 'vitest'
import { splitSafePrefix } from '../lib/markdownStreamBuffer.js'

describe('splitSafePrefix', () => {
  it('returns whole text when no delimiters are open', () => {
    expect(splitSafePrefix('plain prose')).toEqual({ safe: 'plain prose', deferred: '' })
  })

  it('holds back text inside unclosed inline math', () => {
    expect(splitSafePrefix('cost is $O(log ')).toEqual({
      safe: 'cost is ',
      deferred: '$O(log ',
    })
  })

  it('emits whole text once inline math closes', () => {
    expect(splitSafePrefix('cost is $O(log n)$ here')).toEqual({
      safe: 'cost is $O(log n)$ here',
      deferred: '',
    })
  })

  it('holds back unclosed display math', () => {
    expect(splitSafePrefix('see $$ \\int_0^1 x ')).toEqual({
      safe: 'see ',
      deferred: '$$ \\int_0^1 x ',
    })
  })

  it('emits closed display math', () => {
    expect(splitSafePrefix('see $$ \\int_0^1 x \\,dx $$ done')).toEqual({
      safe: 'see $$ \\int_0^1 x \\,dx $$ done',
      deferred: '',
    })
  })

  it('holds back unclosed fenced code', () => {
    expect(splitSafePrefix('```python\ndef foo')).toEqual({
      safe: '',
      deferred: '```python\ndef foo',
    })
  })

  it('emits closed fenced code', () => {
    expect(splitSafePrefix('```python\ndef foo():\n  pass\n```\nafter')).toEqual({
      safe: '```python\ndef foo():\n  pass\n```\nafter',
      deferred: '',
    })
  })

  it('holds back unclosed inline code', () => {
    expect(splitSafePrefix('call `foo()')).toEqual({
      safe: 'call ',
      deferred: '`foo()',
    })
  })

  it('emits closed inline code', () => {
    expect(splitSafePrefix('call `foo()` now')).toEqual({
      safe: 'call `foo()` now',
      deferred: '',
    })
  })

  it('breaks inline math on newline (treats as literal $)', () => {
    expect(splitSafePrefix('$broken\nrest')).toEqual({
      safe: '$broken\nrest',
      deferred: '',
    })
  })

  it('prioritizes fenced code over inline backtick when both candidates exist', () => {
    expect(splitSafePrefix('```\n`inner` still in fence')).toEqual({
      safe: '',
      deferred: '```\n`inner` still in fence',
    })
  })

  it('handles fenced code immediately followed by math', () => {
    expect(splitSafePrefix('```py\nx=1\n```\nand $a')).toEqual({
      safe: '```py\nx=1\n```\nand ',
      deferred: '$a',
    })
  })

  it('is empty-safe', () => {
    expect(splitSafePrefix('')).toEqual({ safe: '', deferred: '' })
  })
})
