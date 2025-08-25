import { describe, it, expect } from 'vitest'
import { DataPath } from '@/domain/entities/DataPath'
import { SegKind } from '@/domain/types/path.types'

const kinds = (dp: DataPath) => dp.segments().map((s) => s.kind)

describe('DataPath.fromString / segments()', () => {
  it('разбирает простые ключи через точку', () => {
    const dp = DataPath.from('com.x.y')
    expect(kinds(dp)).toEqual([SegKind.Key, SegKind.Key, SegKind.Key])
    const segs = dp.segments()
    expect(segs[0].key).toBe('com')
    expect(segs[1].key).toBe('x')
    expect(segs[2].key).toBe('y')
  })

  it('разбирает одиночный wildcard в середине', () => {
    const dp = DataPath.from('a.*.c')
    const segs = dp.segments()
    expect(kinds(dp)).toEqual([SegKind.Key, SegKind.Wildcard, SegKind.Key])
    // промежуточный * не "глубокий"
    expect(segs[1].deepWildcard).toBeFalsy()
  })

  it('разбирает глубокий wildcard в конце', () => {
    const dp = DataPath.from('com.*')
    const segs = dp.segments()
    expect(kinds(dp)).toEqual([SegKind.Key, SegKind.Wildcard])
    // последний * помечается deepWildcard=true конструктором
    expect(segs[1].deepWildcard).toBe(true)
  })

  it('разбирает индекс массива и [*]', () => {
    const a = DataPath.from('rows[0].name')
    expect(kinds(a)).toEqual([SegKind.Key, SegKind.Index, SegKind.Key])
    expect(a.segments()[1].index).toBe(0)

    const b = DataPath.from('rows[*].name')
    expect(kinds(b)).toEqual([SegKind.Key, SegKind.Wildcard, SegKind.Key])
  })

  it('разбирает одиночный параметр в сегменте с числами и строками', () => {
    const n = DataPath.from('com[id=10].x')
    expect(kinds(n)).toEqual([SegKind.Key, SegKind.Param, SegKind.Key])
    expect(n.segments()[1].pkey).toBe('id')
    expect(n.segments()[1].pval).toBe(10)

    const s = DataPath.from('n[name="foo"].v')
    expect(kinds(s)).toEqual([SegKind.Key, SegKind.Param, SegKind.Key])
    expect(s.segments()[1].pkey).toBe('name')
    expect(s.segments()[1].pval).toBe('foo')

    const s2 = DataPath.from('n[name=\'bar\'].v')
    expect(s2.segments()[1].pval).toBe('bar')
  })

  it('fromPlain создаёт ту же структуру (включая deep флаг)', () => {
    const dp = DataPath.fromPlain({
      segs: [{ t: 'key', k: 'com' }, { t: 'wc' }],
      deepOnTail: true,
    })
    expect(kinds(dp)).toEqual([SegKind.Key, SegKind.Wildcard])
    expect(dp.segments()[1].deepWildcard).toBe(true)

    const dp2 = DataPath.fromPlain({
      segs: [
        { t: 'key', k: 'rows' },
        { t: 'idx', i: 3 },
        { t: 'key', k: 'name' },
      ],
      deepOnTail: false,
    })
    expect(kinds(dp2)).toEqual([SegKind.Key, SegKind.Index, SegKind.Key])
    expect(dp2.segments()[1].index).toBe(3)
  })
})
