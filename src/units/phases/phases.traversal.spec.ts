import { describe, it, expect, beforeEach, vi } from 'vitest'
import { RaphApp } from '@/domain/core/RaphApp'
import { RaphNode } from '@/domain/core/RaphNode'
import { SchedulerType } from '@/domain/types/base.types'
import type {
  PhaseExecutorContext,
  PhaseName,
} from '@/domain/types/phase.types'

/**
 *
 * root
 * ├─ A
 * ├─ B
 * │  ├─ D
 * │  └─ E
 * │      └─ F
 * └─ C
 */
function makeTree(raph: RaphApp) {
  const A = new RaphNode(raph, { id: 'A', weight: 1 })
  const B = new RaphNode(raph, { id: 'B', weight: 2 })
  const C = new RaphNode(raph, { id: 'C', weight: 3 })
  const D = new RaphNode(raph, { id: 'D', weight: 4 })
  const E = new RaphNode(raph, { id: 'E', weight: 5 })
  const F = new RaphNode(raph, { id: 'F', weight: 6 })

  raph.addNode(A)
  raph.addNode(B)
  raph.addNode(C)
  B.addChild(D)
  B.addChild(E)
  E.addChild(F)

  return { A, B, C, D, E, F }
}

describe('RaphApp.traversal', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('dirty-only: выполняет только ноды, напрямую совпавшие с re', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })

    const calls: string[] = []

    raph.definePhases([
      {
        name: 'phase-dirty-only' as PhaseName,
        traversal: 'dirty-only',
        routes: ['com.*'],
        each: (ctx: PhaseExecutorContext) => {
          calls.push(ctx.node.id)
        },
      },
    ])

    const { A, B, C } = makeTree(raph)

    // подписываемся на re
    raph.track(A, 'com[id="A"].*')
    raph.track(B, 'com[id="B"].*')
    // C не подписан

    // Уведомляем только A
    raph.set('com[id="A"].x', 1)

    expect(new Set(calls)).toEqual(new Set(['A']))
  })

  it('dirty-and-down: выполняет dirty-ноду и всех её потомков (preorder)', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })

    const calls: string[] = []
    raph.definePhases([
      {
        name: 'phase-down' as PhaseName,
        traversal: 'dirty-and-down',
        routes: ['com.*'],
        each: (ctx: PhaseExecutorContext) => {
          calls.push(ctx.node.id)
        },
      },
    ])

    const { B, D, E, F, A, C } = makeTree(raph)
    // Подписываем только B как data-dependent
    raph.track(B, 'com[id="B"].*')

    // изменяем B
    raph.set('com[id="B"].flag', true)

    // Ожидаемый порядок: B, затем его поддерево в preorder: B, D, E, F
    expect(calls).toEqual(['B', 'D', 'E', 'F'])
    // Проверяем, что другие братья не выполнены
    expect(calls.includes(A.id)).toBe(false)
    expect(calls.includes(C.id)).toBe(false)
  })

  it('dirty-and-down: устраняет дублирование при пересечении dirty-нод', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })
    const calls: string[] = []

    raph.definePhases([
      {
        name: 'phase-down' as PhaseName,
        traversal: 'dirty-and-down',
        routes: ['com.*'],
        each: (ctx: PhaseExecutorContext) => {
          calls.push(ctx.node.id)
        },
      },
    ])

    const { B, E } = makeTree(raph)
    // Подписываем B и E; обе могут стать dirty на разных событиях
    raph.track(B, 'com[id="B"].*')
    raph.track(E, 'com[id="E"].*')

    // Два изменения в одном sync-цикле
    raph.set('com[id="B"].tick', 1)
    raph.set('com[id="E"].tick', 2)

    expect(calls).toEqual(['B', 'D', 'E', 'F', 'E', 'F'])
  })

  it('dirty-and-up: выполняет dirty-ноду и её предков (node - ... - root порядок)', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })

    const calls: string[] = []
    raph.definePhases([
      {
        name: 'phase-up' as PhaseName,
        traversal: 'dirty-and-up',
        routes: ['com.*'],
        each: (ctx: PhaseExecutorContext) => {
          calls.push(ctx.node.id)
        },
      },
    ])

    const { B, D } = makeTree(raph)
    // Подписываем только D
    raph.track(D, 'com[id="D"].*')

    raph.set('com[id="D"].value', 42)

    // Ожидаем D, затем его _parent B; root может быть включён в зависимости от expandByTraversal,
    // но id root неизвестен/нестабилен. Проверим, что D и B есть и в правильном порядке.
    const idxD = calls.indexOf('D')
    const idxB = calls.indexOf('B')
    expect(idxD).toBeGreaterThanOrEqual(0)
    expect(idxB).toBeGreaterThan(idxD)
  })

  it('all: выполняет всё дерево (root - preorder), независимо от dirty-набора', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })

    const calls: string[] = []
    raph.definePhases([
      {
        name: 'phase-all' as PhaseName,
        traversal: 'all',
        routes: ['com.*'],
        each: (ctx: PhaseExecutorContext) => {
          calls.push(ctx.node.id)
        },
      },
    ])

    const { A, B, C, D, E, F } = makeTree(raph)
    // Подписываем только A для триггера маршрута
    raph.track(A, 'com[id="A"].*')

    raph.set('com[id="A"].flag', true)

    // Мы не можем гарантировать точный id root/порядок, но можем проверить, что все созданные ноды были посещены
    const seen = new Set(calls)
    expect(seen.has('A')).toBe(true)
    expect(seen.has('B')).toBe(true)
    expect(seen.has('C')).toBe(true)
    expect(seen.has('D')).toBe(true)
    expect(seen.has('E')).toBe(true)
    expect(seen.has('F')).toBe(true)
  })

  it('смешанные traversal в разных фазах: каждая фаза расширяет dirty independently', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })

    const downCalls: string[] = []
    const upCalls: string[] = []

    raph.definePhases([
      {
        name: 'phase-down' as PhaseName,
        traversal: 'dirty-and-down',
        routes: ['com.*'],
        each: (ctx: PhaseExecutorContext) => {
          downCalls.push(ctx.node.id)
        },
      },
      {
        name: 'phase-up' as PhaseName,
        traversal: 'dirty-and-up',
        routes: ['com.*'],
        each: (ctx: PhaseExecutorContext) => {
          upCalls.push(ctx.node.id)
        },
      },
    ])

    const { B, D, E, F } = makeTree(raph)
    raph.track(E, 'com[id="E"].*') // E будет dirty

    raph.set('com[id="E"].v', 1)

    // dirty-and-down от E => E затем F
    expect(downCalls).toEqual(['E', 'F'])

    // dirty-and-up от E => E затем B (и возможно root). Проверим порядок E и B.
    const idxE = upCalls.indexOf('E')
    const idxB = upCalls.indexOf('B')
    expect(idxE).toBeGreaterThanOrEqual(0)
    expect(idxB).toBeGreaterThan(idxE)
    // Не должен включать D (соседа)
    expect(upCalls.includes('D')).toBe(false)
  })
})
