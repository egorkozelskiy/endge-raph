import { describe, it, expect } from 'vitest'
import type {
  PhaseExecutorContext,
  PhaseName,
} from '@/domain/types/phase.types'
import { RaphSignal } from '@/domain/reactivity/RaphSignal'
import { SchedulerType } from '@/domain/types/base.types'
import { Raph } from '@/domain/core/Raph'
import { RaphApp } from '@/domain/core/RaphApp'
import { DataPath } from '@/domain/entities/DataPath'

/**
 *  вспомогательный each для "compute"-фазы
 *  */
function computeExecutor({ node }: PhaseExecutorContext): void {
  // обновляем только computed-сигналы
  if (node instanceof RaphSignal && typeof node.compute === 'function') {
    node.update()
  }
}

describe('RaphSignal (DAG)', () => {
  it('plain signal: get/set работает и шлёт notify', () => {
    Raph.options({ scheduler: SchedulerType.Sync })

    // фаза, слушающая любые изменения сигналов
    const PHASE = 'test' as PhaseName
    const execCalls: string[] = []
    Raph.definePhases([
      {
        name: PHASE,
        traversal: 'dirty-only',
        routes: ['__signals.*'],
        each: (ctx) => {
          execCalls.push(ctx.node.id)
        },
      },
    ])

    const a = Raph.signal(0)

    // стартовое значение без notify
    a.value = 1
    expect(a.value).toBe(1)

    // изменение — должно вызвать notify (фаза сматчится), но each ничего «особенного» не делает
    a.value = 2
    expect(a.value).toBe(2)
    expect(execCalls.length).toBeGreaterThan(0) // фаза хотя бы раз сработала
  })

  it('computed: вычисляется один раз и пересчитывается при изменении зависимостей', () => {
    const app = new RaphApp()
    app.options({ scheduler: SchedulerType.Sync })

    // compute-фаза: вниз по зависимостям (источник -> зависимости)
    const PHASE = 'compute' as PhaseName
    app.definePhases([
      {
        name: PHASE,
        traversal: 'dirty-and-down',
        routes: ['__signals.*'],
        each: computeExecutor,
      },
    ])

    const a = new RaphSignal<number>(
      app,
      '__signals.a',
      DataPath.fromString('__signals.a'),
    )
    const b = new RaphSignal<number>(
      app,
      '__signals.b',
      DataPath.fromString('__signals.b'),
    )

    app.dataAdapter.set(a.path, 10)
    app.dataAdapter.set(b.path, 5)

    const c = new RaphSignal<number>(
      app,
      '__signals.c',
      DataPath.fromString('__signals.c'),
      () => a.value + b.value,
    )
    // конструктор computed уже сделал первый update() без notify
    expect(c.value).toBe(15)

    // меняем источник -> notify попадёт в a, traversal «вниз» доберётся до c, each вызовет c.update()
    a.value = 20
    app.run()
    expect(c.value).toBe(25)

    b.value = 7
    app.run()
    expect(c.value).toBe(27)
  })

  it('computed: динамическое переключение зависимостей (перестройка рёбер DAG)', () => {
    const app = new RaphApp()
    app.options({ scheduler: SchedulerType.Sync })

    const PHASE = 'compute' as PhaseName
    app.definePhases([
      {
        name: PHASE,
        traversal: 'dirty-and-down',
        routes: ['__signals.*'],
        each: computeExecutor,
      },
    ])

    const flag = new RaphSignal<boolean>(
      app,
      '__signals.flag',
      DataPath.fromString('__signals.flag'),
    )
    const a = new RaphSignal<number>(
      app,
      '__signals.a',
      DataPath.fromString('__signals.a'),
    )
    const b = new RaphSignal<number>(
      app,
      '__signals.b',
      DataPath.fromString('__signals.b'),
    )

    app.dataAdapter.set(flag.path, true)
    app.dataAdapter.set(a.path, 1)
    app.dataAdapter.set(b.path, 100)

    const c = new RaphSignal<number>(
      app,
      '__signals.c',
      DataPath.fromString('__signals.c'),
      () => (flag.value ? a.value : b.value),
    )
    expect(c.value).toBe(1)

    // пока flag=true, c зависит от a: смена a триггерит пересчёт c, смена b — нет
    a.value = 2
    app.run()
    expect(c.value).toBe(2)
    b.value = 999
    app.run()
    expect(c.value).toBe(2) // зависимости не было

    // переключаемся на b: при следующем update() c выстроит ребро от b, а от a — уберёт
    flag.value = false
    app.run() // пересчёт c
    expect(c.value).toBe(999)

    // теперь меняется только b
    b.value = 5
    app.run()
    expect(c.value).toBe(5)
    a.value = 123
    app.run()
    expect(c.value).toBe(5)
  })

  it('computed: попытка присвоения бросает ошибку', () => {
    const app = new RaphApp()
    app.options({ scheduler: SchedulerType.Sync })

    app.definePhases([
      {
        name: 'compute' as PhaseName,
        traversal: 'dirty-and-down',
        routes: ['__signals.*'],
        each: computeExecutor,
      },
    ])

    const x = new RaphSignal<number>(
      app,
      '__signals.x',
      DataPath.fromString('__signals.x'),
    )
    app.dataAdapter.set(x.path, 3)

    const twice = new RaphSignal<number>(
      app,
      '__signals.twice',
      DataPath.fromString('__signals.twice'),
      () => x.value * 2,
    )

    expect(() => {
      // @ts-expect-error — специально проверяем рантайм-ошибку
      (twice as any).value = 100
    }).toThrow()
  })
})
