import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RaphApp } from '@/domain/core/RaphApp'
import { SchedulerType } from '@/domain/types/base.types'
import type {
  PhaseExecutorContext,
  PhaseName,
} from '@/domain/types/phase.types'
import { RaphNode } from '@/domain/core/RaphNode'

describe('RaphApp notify CRUD', () => {
  let raph: RaphApp
  let executorSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })
    executorSpy = vi.fn()

    raph.definePhases([
      {
        name: 'test-phase' as PhaseName,
        traversal: 'dirty-only',
        each: executorSpy,
        routes: ['com.*', 'data.*'],
      },
    ])
  })

  it('set должен вызывать notify и each', () => {
    const node = new RaphNode(raph, { id: 'n1' })
    raph.addNode(node)
    raph.track(node, 'com.*')

    raph.set('com.x', 1)

    expect(raph.dataAdapter.get('com.x')).toBe(1)
    expect(executorSpy).toHaveBeenCalled()
  })

  it('merge должен вызывать notify и each', () => {
    const node = new RaphNode(raph, { id: 'n1' })
    raph.addNode(node)
    raph.track(node, 'data.*')

    raph.set('data.obj', { a: 1 })
    raph.merge('data.obj', { b: 2 })

    expect(raph.dataAdapter.get('data.obj')).toEqual({ a: 1, b: 2 })
    expect(executorSpy).toHaveBeenCalled()
  })

  it('delete должен вызывать notify и each', () => {
    const node = new RaphNode(raph, { id: 'n1' })
    raph.addNode(node)
    raph.track(node, 'com.*')

    raph.set('com.toDelete', 42)
    raph.delete('com.toDelete')

    expect(raph.dataAdapter.get('com.toDelete')).toBeUndefined()
    expect(executorSpy).toHaveBeenCalled()
  })

  it('не должен вызывать each, если нет совпадения по route', () => {
    const node = new RaphNode(raph, { id: 'n1' })
    raph.addNode(node)
    raph.track(node, 'other.*')

    raph.set('com.x', 1)

    expect(executorSpy).not.toHaveBeenCalled()
  })

  it('set должен пометить несколько узлов dirty при совпадении маски', () => {
    const n1 = new RaphNode(raph, { id: 'n1' })
    const n2 = new RaphNode(raph, { id: 'n2' })
    raph.addNode(n1)
    raph.addNode(n2)
    raph.track(n1, 'com.*')
    raph.track(n2, 'com.*')

    raph.set('com.z', 5)

    expect(executorSpy).toHaveBeenCalled()
    const allNodes = executorSpy.mock.calls.map(
      ([ctx]: [PhaseExecutorContext]) => ctx.node.id,
    )
    expect(allNodes).toContain('n1')
    expect(allNodes).toContain('n2')
  })

  it('merge не должен кидать исключения, если пути нет', () => {
    const node = new RaphNode(raph, { id: 'n1' })
    raph.addNode(node)
    raph.track(node, 'com.*')

    expect(() => raph.merge('com.unknown', { x: 1 })).not.toThrow()
    expect(executorSpy).toHaveBeenCalled()
  })

  it('delete не должен кидать исключения, если пути нет', () => {
    const node = new RaphNode(raph, { id: 'n1' })
    raph.addNode(node)
    raph.track(node, 'com.*')

    expect(() => raph.delete('com.unknown')).not.toThrow()
    expect(executorSpy).toHaveBeenCalled()
  })
})
