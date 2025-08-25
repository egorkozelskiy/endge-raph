import { describe, it, expect } from 'vitest'
import { DataPath } from '@/domain/entities/DataPath'

describe('bench.datapath-cache', () => {
  const PATH = 'foo[3].bar[id=42].x.y[*].z'

  it('использует кэш сегментов при повторном разборе', () => {
    // Первый вызов (прогрев, без измерения)
    const first = DataPath.from(PATH)
    const segs1 = first.segments()

    // Замер второго вызова
    const t0 = performance.now()
    const second = DataPath.from(PATH)
    const segs2 = second.segments()
    const t1 = performance.now()

    // Проверка: сегменты должны быть теми же (из кэша, по ссылке)
    expect(segs2).toBe(segs1)

    // Проверка: строковый путь не пересобирается
    const path1 = first.toStringPath()
    const path2 = second.toStringPath()
    expect(path2).toBe(path1)

    // Повторное toStringPath должно вернуть кэш (не заново строить строку)
    const t2 = performance.now()
    const _ = second.toStringPath()
    const t3 = performance.now()

    console.log(
      `[bench.datapath-cache] parse_cached=${(t1 - t0).toFixed(4)}ms, toString_cached=${(t3 - t2).toFixed(4)}ms`,
    )
  })

  it('значительно быстрее при повторных вызовах fromString', () => {
    const SAMPLE_COUNT = 100_000

    // Прогрев и измерение холодного времени (без кеша)
    const t0 = performance.now()
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      DataPath.fromString(`${PATH}_${i}`) // уникальные пути, кеш не срабатывает
    }
    const t1 = performance.now()

    // Измерение горячего кеша
    const t2 = performance.now()
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      DataPath.fromString(`${PATH}_cached`) // один и тот же путь
    }
    const t3 = performance.now()

    const cold = t1 - t0
    const hot = t3 - t2

    console.log(
      `[bench.datapath-cache] cold=${cold.toFixed(2)}ms, hot=${hot.toFixed(2)}ms, speedup=${(cold / hot).toFixed(2)}x`,
    )

    expect(hot).toBeLessThan(cold * 0.5) // кэш должен быть как минимум в 2 раза быстрее
  })
})
