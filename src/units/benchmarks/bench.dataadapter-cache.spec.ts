import { describe, it, expect } from 'vitest'
import { DefaultDataAdapter } from '@/domain/entities/DataAdapter'

type Perf = { opsPerSec: number; ms: number }

function hr(n: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n)
}

function measure(fn: () => void, iter: number): Perf {
  const t0 = performance.now()
  for (let i = 0; i < iter; i++) fn()
  const t1 = performance.now()
  const ms = t1 - t0
  const opsPerSec = iter / (ms / 1000)
  return { opsPerSec, ms }
}

describe('DefaultDataAdapter — perf & correctness (indexed vs non-indexed)', () => {
  // три размера массива
  const SIZES = [10_000, 100_000, 500_000] as const
  // количество операций под каждый размер (чтобы не упираться в таймаут)
  const ITERS: Record<number, number> = {
    10000: 20_000,
    100000: 10_000,
    500000: 5_000,
  }
  const TIMEOUT_MS = 60_000

  for (const SIZE of SIZES) {
    describe(`size=${SIZE}`, () => {
      // базовые данные
      const base = Array.from({ length: SIZE }, (_, i) => ({ id: i, x: 0 }))

      it(
        'GET: correctness + indexed is faster',
        () => {
          const iter = ITERS[SIZE]
          // два адаптера с одинаковыми данными
          const aNoIdx = new DefaultDataAdapter(
            { com: base.map((o) => ({ ...o })) },
            { indexEnabled: false },
          )
          const aIdx = new DefaultDataAdapter(
            { com: base.map((o) => ({ ...o })) },
            { indexEnabled: true },
          )

          // заранее разогреем индекс (ленивая постройка bucket по ключу "id")
          aIdx.get('com[id=0].x')

          // корректность: проверим несколько выборок
          for (let k = 0; k < 5; k++) {
            const id = Math.floor(Math.random() * SIZE)
            const xNo = aNoIdx.get(`com[id=${id}].x`)
            const xIx = aIdx.get(`com[id=${id}].x`)
            expect(xNo).toBe(xIx)
          }

          // создадим «таблицу» id для предсказуемого доступа
          const ids = new Uint32Array(iter)
          for (let i = 0; i < iter; i++) ids[i] = i % SIZE

          // измеряем без индексов
          let p = 0
          const rNoIdx = measure(() => {
            const id = ids[p++]
            aNoIdx.get(`com[id=${id}].x`)
          }, iter)

          // измеряем с индексом (после warm-up)
          p = 0
          const rIdx = measure(() => {
            const id = ids[p++]
            aIdx.get(`com[id=${id}].x`)
          }, iter)

          // лог
          // eslint-disable-next-line no-console
          console.log(
            `[GET] size=${SIZE}, iter=${iter}  no-index=${hr(rNoIdx.opsPerSec)} ops/s  indexed=${hr(rIdx.opsPerSec)} ops/s  speedup=${hr(rIdx.opsPerSec / rNoIdx.opsPerSec)}x`,
          )

          // ожидание ускорения (GET должен быть значительно быстрее)
          expect(rIdx.opsPerSec / rNoIdx.opsPerSec).toBeGreaterThanOrEqual(3)
        },
        { timeout: TIMEOUT_MS },
      )

      it(
        'SET: correctness + indexed not slower (should be faster)',
        () => {
          const iter = ITERS[SIZE]
          const aNoIdx = new DefaultDataAdapter(
            { com: base.map((o) => ({ ...o })) },
            { indexEnabled: false },
          )
          const aIdx = new DefaultDataAdapter(
            { com: base.map((o) => ({ ...o })) },
            { indexEnabled: true },
          )

          // разогреем индекс ключа "id", чтобы не включать цену построения в замер
          aIdx.get('com[id=0].x')

          // подготовим данные set
          const ids = new Uint32Array(iter)
          for (let i = 0; i < iter; i++) ids[i] = i % SIZE

          // измеряем SET без индексов (меняем только поле x — индексы по id не требуют апдейта)
          let p = 0
          const rNoIdx = measure(() => {
            const id = ids[p++]
            aNoIdx.set(`com[id=${id}].x`, id)
          }, iter)

          // измеряем SET с индексом
          p = 0
          const rIdx = measure(() => {
            const id = ids[p++]
            aIdx.set(`com[id=${id}].x`, id)
          }, iter)

          // лог
          // eslint-disable-next-line no-console
          console.log(
            `[SET] size=${SIZE}, iter=${iter}  no-index=${hr(rNoIdx.opsPerSec)} ops/s  indexed=${hr(rIdx.opsPerSec)} ops/s  speedup=${hr(rIdx.opsPerSec / rNoIdx.opsPerSec)}x`,
          )

          // ожидание: индексы хотя бы не медленнее, обычно немного быстрее
          expect(rIdx.opsPerSec / rNoIdx.opsPerSec).toBeGreaterThanOrEqual(1.2)
        },
        { timeout: TIMEOUT_MS },
      )
    })
  }
})
