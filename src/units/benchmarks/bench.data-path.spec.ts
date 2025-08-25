import { describe, it, expect } from 'vitest'
import { DefaultDataAdapter } from '@/domain/entities/DataAdapter'

/**
 * Измеряем:
 *  - глубокие key-цепочки (a.b.c.d…)
 *  - смешанные массивы/параметры: rows[id=...].items[idx].value
 * Проверяем корректность финального состояния и печатаем время.
 */
describe('DefaultDataAdapter deep & nested set() bench', () => {
  it('deep key chains and mixed array/param writes', () => {
    const adapter = new DefaultDataAdapter({}, { autoCreate: true })

    // Глубокие ключевые цепочки
    const DEPTH = 120
    const REPEATS = 200

    const deepPath = Array.from({ length: DEPTH }, (_, i) => `k${i}`).join('.')

    const t0 = performance.now()
    for (let r = 0; r < REPEATS; r++) {
      adapter.set(deepPath, r) // создаёт всю цепочку k0.k1.….k119
    }
    const t1 = performance.now()

    // sanity: значение последнего set
    expect(adapter.get(deepPath)).toBe(REPEATS - 1)

    // --- 2) Смешанные: массивы + параметризованные сегменты
    // rows[id=…].items[idx].value
    const GROUPS = 80
    const ITEMS = 30

    const t2 = performance.now()
    for (let g = 0; g < GROUPS; g++) {
      for (let i = 0; i < ITEMS; i++) {
        adapter.set(`rows[id=${g}].items[${i}].value`, g * 1000 + i)
      }
    }
    const t3 = performance.now()

    // sanity: выборочные проверки
    expect(adapter.get('rows[id=5].items[0].value')).toBe(5000)
    expect(adapter.get('rows[id=79].items[29].value')).toBe(79 * 1000 + 29)

    const deepMs = (t1 - t0).toFixed(2)
    const mixedMs = (t3 - t2).toFixed(2)
    // eslint-disable-next-line no-console
    console.info(
      `[DataAdapter] deep=${DEPTH}*${REPEATS} => ${deepMs}ms; mixed rows=${GROUPS}, items=${ITEMS} => ${mixedMs}ms`,
    )
  })
})
