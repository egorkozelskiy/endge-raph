import { describe, it, expect, vi } from 'vitest'
import { RaphApp } from '@/domain/core/RaphApp'
import { SchedulerType } from '@/domain/types/base.types'
import type {
  PhaseExecutorContext,
  PhaseName,
  RaphPhase,
} from '@/domain/types/phase.types'
import { RaphNode } from '@/domain/core/RaphNode'

describe('RaphApp.scheduler (microtask)', () => {
  it('запускает выполнение в микротаске (не синхронно), затем выполняет executor фазы', async () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Microtask })

    const calls: Array<{ phase: string; node: string }> = []

    const phase: RaphPhase = {
      name: 'phase-1' as PhaseName,
      traversal: 'dirty-only',
      routes: ['foo.*'],
      executor: (ctx: PhaseExecutorContext) => {
        calls.push({ phase: ctx.phase as unknown as string, node: ctx.node.id })
      },
    }

    raph.definePhases([phase])

    const n1 = new RaphNode(raph, { id: 'n1' })
    raph.addNode(n1)
    raph.track(n1, 'foo.*')

    // триггерим
    raph.set('foo.x', 1)

    // сразу после set -> ещё не выполнено (микротаск)
    expect(calls.length).toBe(0)

    // сбрасываем микротаски
    await Promise.resolve()

    expect(calls.length).toBe(1)
    expect(calls[0]).toEqual({ phase: 'phase-1', node: 'n1' })
  })

  it('объединяет несколько инвалидций в одном тике в один run()', async () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Microtask })

    const runSpy = vi.spyOn(raph as any, 'run')

    const exec = vi.fn()
    raph.definePhases([
      {
        name: 'phase-micro' as PhaseName,
        traversal: 'dirty-only',
        routes: ['bar.*'],
        executor: exec,
      },
    ])

    const n = new RaphNode(raph, { id: 'node' })
    raph.addNode(n)
    raph.track(n, 'bar.*')

    // вызываем несколько уведомлений в одном тике
    raph.set('bar.a', 1)
    raph.merge('bar.b', { k: 2 })
    raph.delete('bar.c')

    // всё ещё не выполнено
    expect(exec).not.toHaveBeenCalled()
    expect(runSpy).not.toHaveBeenCalled()

    // сбрасываем микротаски
    await Promise.resolve()

    // ожидается ровно один вызов run
    expect(runSpy).toHaveBeenCalledTimes(1)
    // executor был вызван хотя бы один раз (точное количество зависит от traversal/dirty merge)
    expect(exec).toHaveBeenCalled()
  })

  it('microtask vs sync: microtask откладывает, sync выполняет сразу', async () => {
    // экземпляр с microtask
    const raphMicro = new RaphApp()
    raphMicro.options({ scheduler: SchedulerType.Microtask })

    const microExec = vi.fn()
    raphMicro.definePhases([
      {
        name: 'p' as PhaseName,
        traversal: 'dirty-only',
        routes: ['z.*'],
        executor: microExec,
      },
    ])
    const n1 = new RaphNode(raphMicro, { id: 'n1' })
    raphMicro.addNode(n1)
    raphMicro.track(n1, 'z.*')

    raphMicro.set('z.a', 1)
    expect(microExec).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(microExec).toHaveBeenCalledTimes(1)

    // экземпляр с sync
    const raphSync = new RaphApp()
    raphSync.options({ scheduler: SchedulerType.Sync })

    const syncExec = vi.fn()
    raphSync.definePhases([
      {
        name: 'p' as PhaseName,
        traversal: 'dirty-only',
        routes: ['z.*'],
        executor: syncExec,
      },
    ])
    const n2 = new RaphNode(raphSync, { id: 'n2' })
    raphSync.addNode(n2)
    raphSync.track(n2, 'z.*')

    raphSync.set('z.b', 2)
    expect(syncExec).toHaveBeenCalledTimes(1)
  })
})
