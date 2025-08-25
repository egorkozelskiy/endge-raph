import { describe, it, expect, beforeAll } from 'vitest'
import { RaphApp } from '@/domain/core/RaphApp'
import { RaphNode } from '@/domain/core/RaphNode'
import { SchedulerType } from '@/domain/types/base.types'

/**
 * Бенчмарк: регистрация 10,000 зависимостей через `track`.
 * Цель: убедиться, что операция выполняется быстро и не приводит к взрыву памяти/времени.
 *
 * Примечания:
 * - Используем синхронный планировщик, чтобы избежать шума от RAF/микрозадач.
 * - Пороговые значения намеренно заданы с запасом для работы в CI.
 */

describe('bench.track-x1_000_000', () => {
  const NODE_COUNT = 1000
  const DEPS_PER_NODE = 1000 // 1000 * 1000 = 1_000_000
  const TOTAL_DEPS = NODE_COUNT * DEPS_PER_NODE

  let raph: RaphApp
  const nodes: RaphNode[] = []

  beforeAll(() => {
    raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })

    // создаём плоское дерево узлов
    for (let i = 0; i < NODE_COUNT; i++) {
      const n = new RaphNode(raph, { id: `n_${i}` })
      raph.addNode(n)
      nodes.push(n)
    }
  })

  it(`регистрирует ${TOTAL_DEPS.toLocaleString()} зависимостей быстро`, () => {
    // подготавливаем детерминированный набор зависимостей для каждого узла
    // формат включает точные индексы и параметры с wildcard для нагрузки на парсер
    const depsByNode: string[][] = nodes.map((_, i) => {
      const deps: string[] = []
      for (let d = 0; d < DEPS_PER_NODE; d++) {
        // чередуем индексы массива, свойства и параметры с wildcard
        if (d % 3 === 0) deps.push(`data[${d % 10}].val`)
        else if (d % 3 === 1) deps.push(`com[id="${i}"].p${d % 5}`)
        else deps.push(`rows[id=${d}].x`)
      }
      return deps
    })

    // прогрев (стабилизация JIT/hidden class)
    for (let i = 0; i < NODE_COUNT; i++) {
      for (const dep of depsByNode[i]) {
        raph.track(nodes[i], dep)
      }
    }
    // снимаем все зависимости, чтобы начать замер с чистого состояния
    for (let i = 0; i < NODE_COUNT; i++) {
      raph.untrack(nodes[i])
    }

    // замер времени
    const t0 = performance.now()
    let registered = 0
    for (let i = 0; i < NODE_COUNT; i++) {
      for (const dep of depsByNode[i]) {
        raph.track(nodes[i], dep)
        registered++
      }
    }
    const t1 = performance.now()

    // проверка
    expect(registered).toBe(TOTAL_DEPS)

    // Порог для CI (можно скорректировать для вашей инфраструктуры)
    const elapsed = t1 - t0
    // Ожидаем < 500 мс для 10k зависимостей в типичном CI; увеличьте, если ваш CI медленнее.
    expect(elapsed).toBeLessThan(1000)

    // оставляем следы для ручной проверки при локальном запуске
    // eslint-disable-next-line no-console
    console.log(
      `[bench.track-x1_000_000] зарегистрировано=${registered}, время=${elapsed.toFixed(
        2,
      )}мс, на операцию=${(elapsed / registered).toFixed(6)}мс`,
    )
  })

  it('быстро снимает все зависимости после массовой регистрации', () => {
    const t0 = performance.now()
    for (const n of nodes) {
      raph.untrack(n)
    }
    const t1 = performance.now()
    const elapsed = t1 - t0

    // Ожидаем, что снятие зависимостей будет таким же быстрым (не более ~500 мс для всех)
    expect(elapsed).toBeLessThan(1000)

    // eslint-disable-next-line no-console
    console.log(
      `[bench.track-x1_000_000] время снятия всех зависимостей=${elapsed.toFixed(
        2,
      )}мс`,
    )
  })
})
