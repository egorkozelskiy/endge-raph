import { describe, expect, it } from 'vitest'
import { SchedulerType } from '@/domain/types/base.types'
import { RaphApp } from '@/domain/core/RaphApp'
import type { PhaseName } from '@/domain/types/phase.types'
import { RaphNode } from '@/domain/core/RaphNode'

describe('Dep Graph', () => {
  it('выполняет в порядке по depth, а внутри уровня — по weight (больше раньше)', () => {
    const app = new RaphApp()
    app.options({ scheduler: SchedulerType.Sync })
    const calls: string[] = []

    app.definePhases([
      {
        name: 'P' as PhaseName,
        traversal: 'dirty-only',
        routes: ['*'],
        executor: ({ node }) => calls.push(node.id),
      },
    ])

    const A = new RaphNode(app, { id: 'A', weight: 0 })
    const B = new RaphNode(app, { id: 'B', weight: 5 })
    const C = new RaphNode(app, { id: 'C', weight: 3 })
    const D = new RaphNode(app, { id: 'D', weight: 10 }) // тот же depth, больший weight
    const E = new RaphNode(app, { id: 'E', weight: 1 }) // тот же depth, меньший weight

    app.addNode(A)
    app.addNode(B)
    app.addNode(C)
    app.addNode(D)
    app.addNode(E)

    // граф: A -> B -> C; A -> D; A -> E  (значит: depth(A)=0; depth(B|D|E)=1; depth(C)=2)
    app.addDependency(A, B)
    app.addDependency(B, C)
    app.addDependency(A, D)
    app.addDependency(A, E)

    // Пометим все узлы грязными разом (порядок добавления не должен влиять)
    for (const n of [E, C, A, D, B])
      app.dirty('P' as PhaseName, n, {
        invalidate: false,
      })
    app.run()

    // Ожидаем:
    // depth 0: A
    // depth 1: D (weight 10) потом B (5) потом E (1)
    // depth 2: C
    expect(calls).toEqual(['A', 'D', 'B', 'E', 'C'])
  })
})
