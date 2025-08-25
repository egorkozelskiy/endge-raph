import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SchedulerType } from '@/domain/types/base.types'
import { RaphApp } from '@/domain/core/RaphApp'
import type {
  PhaseExecutorContext,
  PhaseName,
} from '@/domain/types/phase.types'
import { RaphNode } from '@/domain/core/RaphNode'

describe('RaphApp.scheduler-sync', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('executes phase synchronously on set()', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })

    const calls: Array<{ phase: string; nodeId: string }> = []
    raph.definePhases([
      {
        name: 'sync-phase' as PhaseName,
        traversal: 'dirty-only',
        routes: ['com.*'],
        executor: (ctx: PhaseExecutorContext) => {
          calls.push({ phase: String(ctx.phase), nodeId: ctx.node.id })
        },
      },
    ])

    const n = new RaphNode(raph, { id: 'n1' })
    raph.addNode(n)
    raph.track(n, 'com.x')

    // set должен синхронно вызвать notify -> dirty -> run -> executor
    raph.set('com.x', 1)

    expect(calls.length).toBe(1)
    expect(calls[0]).toEqual({ phase: 'sync-phase', nodeId: 'n1' })
  })

  it('executes synchronously on notify() as well', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })

    const exec = vi.fn()
    raph.definePhases([
      {
        name: 'sync-phase' as PhaseName,
        traversal: 'dirty-only',
        routes: ['com.*'],
        executor: exec,
      },
    ])

    const n = new RaphNode(raph, { id: 'n1' })
    raph.addNode(n)
    raph.track(n, 'com.x')

    raph.notify('com.x')

    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('does not require ticks; two consecutive sets cause two immediate executions (no batching)', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })

    const exec = vi.fn()
    raph.definePhases([
      {
        name: 'sync-phase' as PhaseName,
        traversal: 'dirty-only',
        routes: ['com.*'],
        executor: exec,
      },
    ])

    const n = new RaphNode(raph, { id: 'n1' })
    raph.addNode(n)
    raph.track(n, 'com.x')

    raph.set('com.x', 1)
    raph.set('com.x', 2)

    expect(exec).toHaveBeenCalledTimes(2)
  })

  it('respects traversal=dirty-and-down synchronously', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })

    const seen: string[] = []
    raph.definePhases([
      {
        name: 'sync-phase' as PhaseName,
        traversal: 'dirty-and-down',
        routes: ['com.*'],
        executor: (ctx) => {
          seen.push(ctx.node.id)
        },
      },
    ])

    const p = new RaphNode(raph, { id: 'parent' })
    const c1 = new RaphNode(raph, { id: 'child1' })
    const c2 = new RaphNode(raph, { id: 'child2' })
    raph.addNode(p)
    p.addChild(c1)
    p.addChild(c2)

    // зависимость только на родителе
    raph.track(p, 'com.x')

    raph.set('com.x', 1)

    // ожидание: вызван _parent и оба его потомка синхронно
    expect(seen.sort()).toEqual(['child1', 'child2', 'parent'].sort())
  })
})
