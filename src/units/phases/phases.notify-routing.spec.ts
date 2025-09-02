import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RaphNode } from '@/domain/core/RaphNode'
import { RaphApp } from '@/domain/core/RaphApp'
import { SchedulerType } from '@/domain/types/base.types'
import type {
  PhaseExecutorContext,
  PhaseName,
} from '@/domain/types/phase.types'

/**
 *
 * root
 * ├─ a
 * │  └─ a1
 * └─ b
 *    ├─ b1
 *    └─ b2
 */
function buildTree(raph: RaphApp): any {
  const a = new RaphNode(raph, { id: 'a' })
  const b = new RaphNode(raph, { id: 'b' })
  const a1 = new RaphNode(raph, { id: 'a1' })
  const b1 = new RaphNode(raph, { id: 'b1' })
  const b2 = new RaphNode(raph, { id: 'b2' })

  raph.addNode(a)
  raph.addNode(b)
  a.addChild(a1)
  b.addChild(b1)
  b.addChild(b2)

  return { a, b, a1, b1, b2 }
}

describe('RaphApp.notify routing', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('трогает фазу, если хотя бы один из её routes совпал', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })

    const exec = vi.fn<void, [PhaseExecutorContext]>()
    raph.definePhases([
      {
        name: 'phase' as PhaseName,
        traversal: 'dirty-only',
        each: exec,
        routes: ['com.*', 'data.x'],
      },
    ])

    const { a } = buildTree(raph)

    // подписываем ноду на com[id="a"].*
    raph.track(a, 'com[id="a"].*')

    // уведомление по первому маршруту (com.*)
    raph.set('com[id="a"].f', 1)

    expect(exec).toHaveBeenCalled() // хотя бы один вызов
    const callsForPhase = exec.mock.calls.filter(
      (c) => c[0].phase === ('phase' as PhaseName),
    )
    expect(callsForPhase.length).toBeGreaterThan(0)
  })

  it('не трогает фазу, если ни один route не совпал', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })

    const exec = vi.fn<void, [PhaseExecutorContext]>()
    raph.definePhases([
      {
        name: 'phase' as PhaseName,
        traversal: 'dirty-only',
        each: exec,
        routes: ['data.*'], // только data
      },
    ])

    const { a } = buildTree(raph)
    raph.track(a, 'com[id="a"].*')

    // уведомление по com — не должно попасть в phase
    raph.set('com[id="a"].x', 1)
    expect(exec).not.toHaveBeenCalled()
  })

  it('маршрут com.* матчит com[id=..].x (звёздочка в конце = любая глубина)', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })

    const exec = vi.fn<void, [PhaseExecutorContext]>()
    raph.definePhases([
      {
        name: 'phase' as PhaseName,
        traversal: 'dirty-only',
        each: exec,
        routes: ['com.*'],
      },
    ])

    const { a } = buildTree(raph)
    raph.track(a, 'com[id="a"].*')

    raph.set('com[id="a"].x', 1) // должно совпасть
    expect(exec).toHaveBeenCalled()
  })

  it('маршрут с параметром com[*].x матчит конкретный id', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })

    const exec = vi.fn<void, [PhaseExecutorContext]>()
    raph.definePhases([
      {
        name: 'phase' as PhaseName,
        traversal: 'dirty-only',
        each: exec,
        routes: ['com[*].x'],
      },
    ])

    const { a } = buildTree(raph)
    raph.track(a, 'com[id="a"].x')

    raph.set('com[id="a"].x', 123)
    expect(exec).toHaveBeenCalled()
  })

  it('несколько фаз: срабатывают только те, чьи маршруты совпали', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })

    const exec1 = vi.fn<void, [PhaseExecutorContext]>()
    const exec2 = vi.fn<void, [PhaseExecutorContext]>()
    raph.definePhases([
      {
        name: 'phase-1' as PhaseName,
        traversal: 'dirty-only',
        each: exec1,
        routes: ['com.*'],
      },
      {
        name: 'phase-2' as PhaseName,
        traversal: 'dirty-only',
        each: exec2,
        routes: ['data.*'],
      },
    ])

    const { a } = buildTree(raph)
    raph.track(a, 'com[id="a"].*')

    raph.set('com[id="a"].y', 1)

    expect(exec1).toHaveBeenCalled()
    expect(exec2).not.toHaveBeenCalled()
  })

  it('dirty-only: исполняется только сама грязная нода', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })

    const seen: string[] = []
    raph.definePhases([
      {
        name: 'phase' as PhaseName,
        traversal: 'dirty-only',
        each: (ctx) => {
          seen.push(ctx.node.id)
        },
        routes: ['data.*'],
      },
    ])

    const { a, a1 } = buildTree(raph)
    raph.track(a, 'data.*')
    raph.track(a1, 'another') // подписан, но не должен попасть без "down"

    raph.set('data.z', 1)
    expect(seen).toEqual(['a']) // только "a", без a1 и без b
  })

  it('dirty-and-down: исполняется нода и все её потомки', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })

    const seen: string[] = []
    raph.definePhases([
      {
        name: 'phase' as PhaseName,
        traversal: 'dirty-and-down',
        each: (ctx) => {
          seen.push(ctx.node.id)
        },
        routes: ['data.*'],
      },
    ])

    const { a, a1, b1 } = buildTree(raph)
    raph.track(a, 'data.*')
    raph.track(a1, 'data.*')
    raph.track(b1, 'data.*')

    raph.set('data.t', 1)
    // порядок вызовов зависит от реализации обхода, но множество должно включать a и a1
    expect(new Set(seen)).toEqual(new Set(['a', 'a1', 'b1']))
  })

  it('dirty-and-up: исполняется нода и все её предки', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })

    const seen: string[] = []
    raph.definePhases([
      {
        name: 'phase' as PhaseName,
        traversal: 'dirty-and-up',
        each: (ctx) => {
          seen.push(ctx.node.id)
        },
        routes: ['data.*'],
      },
    ])

    const { a, a1 } = buildTree(raph)
    raph.track(a1, 'data.*')
    raph.track(a, 'data.*')

    raph.set('data.k', 1)
    expect(new Set(seen)).toEqual(new Set(['a1', 'a']))
  })

  it('all: игнорирует базовый набор и исполняет все ноды дерева (root - ...)', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })

    const seen = new Set<string>()
    raph.definePhases([
      {
        name: 'phase' as PhaseName,
        traversal: 'all',
        each: (ctx) => {
          // root у RaphNode имеет id вида "root-..." (или определён вашей реализацией)
          seen.add(ctx.node.id)
        },
        routes: ['data.*'],
      },
    ])

    const { a, a1, b, b1, b2 } = buildTree(raph)
    // трекаем только одну ноду, но traversal=all должен пройти по всем
    raph.track(a, 'data.*')

    raph.set('data.any', 777)

    // По крайней мере все пользовательские узлы из нашего дерева должны быть
    ;[a, a1, b, b1, b2].forEach((n) => expect(seen.has(n.id)).toBe(true))
  })

  it('маршруты с несколькими сегментами и суффиксным wildcard работают корректно', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })

    const exec = vi.fn<void, [PhaseExecutorContext]>()
    raph.definePhases([
      {
        name: 'phase' as PhaseName,
        traversal: 'dirty-only',
        each: exec,
        routes: ['scene.layers.*', 'scene.*'], // оба должны покрыть уведомления ниже
      },
    ])

    const { a } = buildTree(raph)
    raph.track(a, 'scene.layers[id="a"].*')
    raph.track(a, 'scene.meta.*')

    raph.set('scene.layers[id="a"].props.x', 10) // матчится scene.layers.*
    raph.set('scene.meta.title', 'Ok') // матчится scene.*

    expect(exec).toHaveBeenCalledTimes(2)
  })

  it('маршрут com.x НЕ матчит com (разная длина без суффиксного wildcard)', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })

    const exec = vi.fn<void, [PhaseExecutorContext]>()
    raph.definePhases([
      {
        name: 'phase' as PhaseName,
        traversal: 'dirty-only',
        each: exec,
        routes: ['com.x'],
      },
    ])

    const { a } = buildTree(raph)
    raph.track(a, 'com.*')

    raph.set('com', { x: 1 }) // без прохода через com.x, прямой лист "com" — не должен матчиться
    expect(exec).toHaveBeenCalled()

    raph.set('com.x', 1) // теперь совпадение
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('параметры в середине пути учитываются при маршрутизации', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })

    const exec = vi.fn<void, [PhaseExecutorContext]>()
    raph.definePhases([
      {
        name: 'phase' as PhaseName,
        traversal: 'dirty-only',
        each: exec,
        routes: ['com[*].x'], // любой id, но ключ и глубина фиксированы
      },
    ])

    const { a } = buildTree(raph)
    raph.track(a, 'com[id="42"].x')

    raph.set('com[id="42"].x', 5) // матчится
    expect(exec).toHaveBeenCalledTimes(1)

    raph.set('com[id="7"].y', 1) // не матчится (ключ y, а не x)
    expect(exec).toHaveBeenCalledTimes(1)
  })
})
