import { describe, it, expect } from 'vitest'
import { DataPath } from '@/domain/entities/DataPath'
import { SegKind } from '@/domain/types/path.types'

/**
 * помогает проверить, что round‑trip сохраняет семантику
 */
function roundTripString(s: string): void {
  const dp = DataPath.from(s)
  const s2 = dp.toStringPath()
  const dp2 = DataPath.from(s2)
  // Сравним семантику через взаимный match:
  expect(DataPath.match(s, s2)).toBe(true)
  expect(DataPath.match(s2, s)).toBe(true)
  // Сегменты должны совпасть по видам
  expect(dp2.segments().map((x) => x.kind)).toEqual(
    dp.segments().map((x) => x.kind),
  )
}

describe('DataPath.toStringPath / toPlain (сериализация)', () => {
  it('string round‑trip: простая точечная нотация', () => {
    roundTripString('com.x.y')
  })

  it('string round‑trip: одиночный wildcard в середине', () => {
    roundTripString('a.*.c')
  })

  it('string round‑trip: глубокий wildcard в конце', () => {
    roundTripString('com.*')
    roundTripString('root.level.*')
  })

  it('string round‑trip: индекс массива / [*]', () => {
    roundTripString('rows[0].name')
    roundTripString('rows[*].name')
  })

  it('string round‑trip: параметры с числами и кавычками', () => {
    roundTripString('com[id=10].x')
    roundTripString('n[name="foo"].v')
    roundTripString("n[name='bar'].v")
  })

  it('toPlain / fromPlain round‑trip сохраняет структуру и флаг deep', () => {
    const source = 'root.level.*'
    const dp = DataPath.from(source)
    const plain = dp.toPlain()
    const dp2 = DataPath.fromPlain(plain)

    const kinds1 = dp.segments().map((s) => s.kind)
    const kinds2 = dp2.segments().map((s) => s.kind)
    expect(kinds2).toEqual(kinds1)

    // проверим, что tail‑wildcard остался «глубоким»
    const last = dp2.segments()[dp2.segments().length - 1]
    expect(last.kind).toBe(SegKind.Wildcard)
    expect(last.deepWildcard).toBe(true)

    // и что строковая форма совпадает по семантике
    expect(DataPath.match(dp.toStringPath(), dp2.toStringPath())).toBe(true)
    expect(DataPath.match(dp2.toStringPath(), dp.toStringPath())).toBe(true)
  })

  it('toStringPath: детали форматирования', () => {
    // важные форматы — чтобы не было лишних точек
    const s1 = DataPath.from('com.*.x').toStringPath()
    expect(s1).toBe('com.*.x')

    const s2 = DataPath.from('rows[*].name').toStringPath()
    // допускаем сериализацию как 'rows.*.name' — парсер воспринимает эквивалентно
    expect(['rows[*].name', 'rows.*.name']).toContain(s2)

    const s3 = DataPath.from('n[name="foo"].v').toStringPath()
    expect(s3).toBe('n[name="foo"].v')

    const s4 = DataPath.from('rows[0].name').toStringPath()
    expect(s4).toBe('rows[0].name')
  })
})
