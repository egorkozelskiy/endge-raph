import { describe, expect, it } from 'vitest'
import { MinHeap } from '@/domain/entities/MinHeap'

// Детеминированный RNG (LCG), чтобы бенчи были воспроизводимыми
function makeLCG(seed = 123456789): any {
  let s = seed >>> 0
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0)
}

// Пороговые значения для бенчей можно переопределить env-переменными
const THRESH_PUSH_POP_MS = Number(process.env.MINHEAP_BENCH_PUSH_POP_MS ?? 2000)
const THRESH_BUILD_POP_MS = Number(
  process.env.MINHEAP_BENCH_BUILD_POP_MS ?? 1500,
)
const N_SMALL = 5000
const N_MED = 100_000

describe('MinHeap: бенчмарки (CI-friendly)', () => {
  it(`bench: push(${N_MED}) + pop(${N_MED}) укладывается в ${THRESH_PUSH_POP_MS}ms`, () => {
    const h = new MinHeap()
    const rng = makeLCG(2025)

    const t0 = performance.now()
    for (let i = 0; i < N_MED; i++) h.push(rng() % 1_000_000 | 0)
    for (let i = 0; i < N_MED; i++) h.pop()
    const t1 = performance.now()

    const elapsed = t1 - t0
    // eslint-disable-next-line no-console
    console.log(
      `[MinHeap bench] push+pop N=${N_MED}, time=${elapsed.toFixed(2)}ms, perOp=${(
        (elapsed * 1000) /
        (N_MED * 2)
      ).toFixed(2)}ns`,
    )
    expect(elapsed).toBeLessThan(THRESH_PUSH_POP_MS)
  })

  it(`bench: buildFrom(${N_MED}) + pop(${N_MED}) укладывается в ${THRESH_BUILD_POP_MS}ms`, () => {
    const h = new MinHeap()
    const rng = makeLCG(777)
    const arr = Array.from({ length: N_MED }, () => rng() % 1_000_000 | 0)

    const t0 = performance.now()
    h.buildFrom(arr)
    for (let i = 0; i < N_MED; i++) h.pop()
    const t1 = performance.now()

    const elapsed = t1 - t0
    // eslint-disable-next-line no-console
    console.log(
      `[MinHeap bench] buildFrom+pop N=${N_MED}, time=${elapsed.toFixed(
        2,
      )}ms, perOp=${((elapsed * 1000) / (N_MED + N_MED)).toFixed(2)}ns`,
    )
    expect(elapsed).toBeLessThan(THRESH_BUILD_POP_MS)
  })

  it('bench: сравнение buildFrom vs последовательный push (логгируем, без строгого ассерта)', () => {
    const rng1 = makeLCG(999)
    const rng2 = makeLCG(999)
    const arr1 = Array.from({ length: N_SMALL }, () => rng1() % 1_000_000 | 0)
    const arr2 = Array.from({ length: N_SMALL }, () => rng2() % 1_000_000 | 0)

    // buildFrom
    const hb = new MinHeap()
    let t0 = performance.now()
    hb.buildFrom(arr1)
    while (!hb.empty) hb.pop()
    let t1 = performance.now()
    const tBuild = t1 - t0

    // push
    const hp = new MinHeap()
    t0 = performance.now()
    for (let i = 0; i < arr2.length; i++) hp.push(arr2[i])
    while (!hp.empty) hp.pop()
    t1 = performance.now()
    const tPush = t1 - t0

    // eslint-disable-next-line no-console
    console.log(
      `[MinHeap bench] N=${N_SMALL} :: buildFrom=${tBuild.toFixed(
        2,
      )}ms, push=${tPush.toFixed(2)}ms`,
    )

    // Оба должны быть "быстрыми" (большой запас)
    expect(tBuild).toBeLessThan(1500)
    expect(tPush).toBeLessThan(2000)
  })
})
