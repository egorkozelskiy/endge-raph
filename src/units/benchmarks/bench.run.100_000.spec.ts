import { describe, it, expect } from 'vitest'
import { RaphApp } from '@/domain/core/RaphApp'
import { SchedulerType } from '@/domain/types/base.types'
import { RaphNode } from '@/domain/core/RaphNode'
import type {
  PhaseExecutorContext,
  PhaseName,
  RaphPhase,
} from '@/domain/types/phase.types'

/**
 * Бенчмарк фазы run():
 * 1) Строим большую иерархию нод
 * 2) Регистрируем много фаз с разными traversal и маршрутами
 * 3) Помечаем данные через set() (invalidate временно заглушаем, чтобы не вызвать run)
 * 4) Измеряем время одного вызова run()
 */
describe('bench.run() большая графовая структура и множество фаз', () => {
  it('выполняет фазы на большом наборе помеченных данных', () => {
    const raph = new RaphApp()
    raph.options({
      scheduler: SchedulerType.Sync, // вручную вызовем run()
    })

    // 1) Большая иерархия
    // levels=5, branching=6 => ~9 331 узел (включая root)
    // Можно варьировать для сравнения конфигураций.
    const LEVELS = 5
    const BRANCH = 6

    const ids: string[] = []

    const makeTree = (
      parent: RaphNode | null,
      level: number,
      prefix: string,
    ): void => {
      if (level >= LEVELS) return
      for (let i = 0; i < BRANCH; i++) {
        const id = `${prefix}_${level}_${i}`
        const weight = ((level * 53 + i * 17) % 255) + 1
        const n = new RaphNode(raph, { id, weight })
        if (parent) {
          parent.addChild(n)
        } else {
          raph.addNode(n)
        }
        ids.push(id)
        makeTree(n, level + 1, id)
      }
    }

    // добавляем детей к root
    makeTree(null, 0, 'n')

    // 2) Трекинг зависимостей для разных слоёв данных
    //    - часть нод слушает 'data.*'
    //    - часть — 'com.*'
    //    - часть — персональные ключи: `com[id="..."].*`
    for (let idx = 0; idx < ids.length; idx++) {
      const node = raph.getNode(ids[idx])!
      if (idx % 2 === 0) raph.track(node, 'data.*')
      if (idx % 3 === 0) raph.track(node, 'com.*')
      if (idx % 5 === 0) raph.track(node, `com[id="${ids[idx]}"].*`)
    }

    // 3) Много фаз
    const execCounters: Record<string, number> = {}
    const mkPhase = (
      name: string,
      traversal: 'dirty-only' | 'dirty-and-down' | 'dirty-and-up' | 'all',
      routes: string[],
    ): RaphPhase => ({
      name: name as PhaseName,
      traversal,
      routes,
      executor: (_ctx: PhaseExecutorContext) => {
        execCounters[name] = (execCounters[name] ?? 0) + 1
      },
    })

    const phases: RaphPhase[] = [
      mkPhase('p-data-dirty', 'dirty-only', ['data.*']),
      mkPhase('p-com-down', 'dirty-and-down', ['com.*']),
      mkPhase('p-com-up', 'dirty-and-up', ['com.*']),
      mkPhase('p-all-config', 'all', ['config.*']), // по маршруту попадём, если будут изменения в config
      mkPhase('p-specific', 'dirty-only', ['com.*', 'data.*']),
      mkPhase('p-data-up', 'dirty-and-up', ['data.*']),
      mkPhase('p-com-dirty', 'dirty-only', ['com.*']),
      mkPhase('p-mixed-down', 'dirty-and-down', ['data.*', 'com.*']),
      mkPhase('p-mixed-up', 'dirty-and-up', ['data.*', 'com.*']),
      mkPhase('p-all-other', 'all', ['other.*']),
    ]

    raph.definePhases(phases)

    // 4) Массовые изменения данных для пометки dirty
    //    IMPORTANT: заглушим invalidate() на время set(), чтобы не запускать run() в момент записи
    const SETS_DATA = 1200
    for (let i = 0; i < SETS_DATA; i++) {
      raph.set(`data.k${i}`, i, { invalidate: false })
    }

    // несколько адресных попаданий по com[id="..."].*
    for (let i = 0; i < Math.min(300, ids.length); i += 7) {
      raph.set(`com[id="${ids[i]}"].x`, i, { invalidate: false })
    }

    //
    // записей в com.* (широкие маршруты)
    for (let i = 0; i < 600; i++) {
      raph.set(`com.k${i}`, i, { invalidate: false })
    }

    // 5) Бенчмаркинг самого run()
    const t0 = performance.now()
    raph.run()
    const t1 = performance.now()
    const total = t1 - t0

    // sanity: должны быть вызовы хотя бы у фаз, которые матчились (data.*, com.*)
    const totalExec = Object.values(execCounters).reduce((a, b) => a + b, 0)
    expect(totalExec).toBeGreaterThan(0)

    // eslint-disable-next-line no-console
    console.info(
      `[bench.run()] nodes=${ids.length}, phases=${phases.length}, execCalls=${totalExec}, time=${total.toFixed(
        3,
      )}ms`,
    )

    // Дополнительно выведем распределение по фазам:
    // eslint-disable-next-line no-console
    console.info(
      Object.entries(execCounters)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}:${v}`)
        .join(', '),
    )
  })
})
