import { describe, it, expect } from 'vitest'
import { SchedulerType } from '@/domain/types/base.types'
import { RaphApp } from '@/domain/core/RaphApp'
import type {
  PhaseExecutorContext,
  PhaseName,
} from '@/domain/types/phase.types'
import { RaphNode } from '@/domain/core/RaphNode'

/**
 * Bench: 1000 последовательных notify/set.
 * Цель — убедиться, что:
 *  - исполнители фаз вызываются корректно
 *  - время на 1000 нотификаций разумное (порог не проверяем жёстко)
 *  - планировщик Sync даёт синхронное исполнение
 *
 * Примерные допустимые результаты:
 * [bench.notify x1000] total=1316.789ms, per op ~1.3168ms
 * [bench.notify fanout x1000] total=4669.211ms
 */
describe('bench.notify x1_000', () => {
  //
  //
  //
  it('notifies 1_000 times (sync scheduler) and executes phase for tracked node', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })

    let execCount = 0
    raph.definePhases([
      {
        name: 'bench-phase' as PhaseName,
        traversal: 'dirty-only',
        routes: ['data.*'], // реагируем на любые изменения под data.*
        each: (_ctx: PhaseExecutorContext) => {
          execCount++
        },
      },
    ])

    // Один отслеживаемый узел, чтобы проверить точный счётчик вызовов
    const n1 = new RaphNode(raph, { id: 'n1' })
    raph.addNode(n1)
    raph.track(n1, 'data.*')

    // Прогоняем 1000 set/notify; планировщик Sync — всё выполнится синхронно
    const ITER = 1000
    const t0 = performance.now()

    for (let i = 0; i < ITER; i++) {
      // меняем разные поля, чтобы не перетирать одно и то же
      raph.set(`data.v${i}`, i)
      // (set сам вызовет notify внутри)
    }

    const t1 = performance.now()
    const totalMs = t1 - t0
    const perOp = totalMs / ITER

    // Функциональная проверка: исполнитель фазы вызван ровно ITER раз
    expect(execCount).toBe(ITER)

    // Отладочная метрика — не "ожидание", просто лог в отчёт
    // eslint-disable-next-line no-console
    console.info(
      `[bench.notify x${ITER}] total=${totalMs.toFixed(
        3,
      )}ms, per op ~${perOp.toFixed(4)}ms`,
    )
  })

  //
  //
  //
  it('notifies 1_000 times with small tree (dirty-and-down) to simulate fanout', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })

    // Небольшое дерево: root -> a -> (b,c), a -> d
    const a = new RaphNode(raph, { id: 'a' })
    const b = new RaphNode(raph, { id: 'b' })
    const c = new RaphNode(raph, { id: 'c' })
    const d = new RaphNode(raph, { id: 'd' })
    raph.addNode(a)
    a.addChild(b)
    a.addChild(c)
    a.addChild(d)

    // Отслеживаем только `a`, но traversal = dirty-and-down
    // => при отметке `a` грязным исполним фазу и по его потомкам
    raph.track(a, 'data.*')

    const seen = new Set<string>()
    raph.definePhases([
      {
        name: 'fanout-phase' as PhaseName,
        traversal: 'dirty-and-down',
        routes: ['data.*'],
        each: (ctx: PhaseExecutorContext) => {
          seen.add(ctx.node.id)
        },
      },
    ])

    const ITER = 1_000
    const t0 = performance.now()

    for (let i = 0; i < ITER; i++) {
      raph.set(`data.k${i}`, i)
    }

    const t1 = performance.now()
    const totalMs = t1 - t0

    // Ожидаем, что были охвачены узлы a,b,c,d (в разное время, но по факту — все появятся в set)
    expect(seen.has('a')).toBe(true)
    expect(seen.has('b')).toBe(true)
    expect(seen.has('c')).toBe(true)
    expect(seen.has('d')).toBe(true)

    // eslint-disable-next-line no-console
    console.info(`[bench.notify fanout x${ITER}] total=${totalMs.toFixed(3)}ms`)
  })
})
