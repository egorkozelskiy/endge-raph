import { describe, it, expect, vi } from 'vitest'
import type {
  PhaseExecutorContext,
  PhaseName,
  RaphPhase,
} from '@/domain/types/phase.types'
import { RaphApp } from '@/domain/core/RaphApp'

describe('RaphApp.definePhases', () => {
  it('сохраняет фазы в массиве с сохранением порядка', () => {
    const raph = new RaphApp()

    const execA = vi.fn((ctx: PhaseExecutorContext) => {})
    const execB = vi.fn((ctx: PhaseExecutorContext) => {})

    const phases: RaphPhase[] = [
      {
        name: 'phase-A' as PhaseName,
        traversal: 'dirty-only',
        executor: execA,
        routes: ['x.*'],
      },
      {
        name: 'phase-B' as PhaseName,
        traversal: 'all',
        executor: execB,
        routes: ['y.*'],
      },
    ]

    raph.definePhases(phases)

    // порядок сохраняется в .phases
    expect(raph.phases.map((p) => p.name)).toEqual(['phase-A', 'phase-B'])
    // executors — те же самые ссылки
    expect(raph.phases[0].executor).toBe(execA)
    expect(raph.phases[1].executor).toBe(execB)
  })

  it('заполняет карту фаз для быстрого поиска по имени', () => {
    const raph = new RaphApp()

    const execA = vi.fn((ctx: PhaseExecutorContext) => {})
    const execB = vi.fn((ctx: PhaseExecutorContext) => {})

    raph.definePhases([
      {
        name: 'alpha' as PhaseName,
        traversal: 'dirty-only',
        executor: execA,
        routes: ['a.*'],
      },
      {
        name: 'beta' as PhaseName,
        traversal: 'dirty-only',
        executor: execB,
        routes: ['b.*'],
      },
    ])

    const alpha = raph.getPhase('alpha' as PhaseName)
    const beta = raph.getPhase('beta' as PhaseName)

    expect(alpha).toBeDefined()
    expect(beta).toBeDefined()
    expect(alpha!.executor).toBe(execA)
    expect(beta!.executor).toBe(execB)
  })

  it('заменяет ранее определённые фазы при повторном вызове', () => {
    const raph = new RaphApp()

    raph.definePhases([
      {
        name: 'old-1' as PhaseName,
        traversal: 'dirty-only',
        executor: vi.fn(),
        routes: ['x.*'],
      },
      {
        name: 'old-2' as PhaseName,
        traversal: 'dirty-only',
        executor: vi.fn(),
        routes: ['y.*'],
      },
    ])

    // переопределяем другим набором и порядком
    const execN = vi.fn()
    raph.definePhases([
      {
        name: 'new-2' as PhaseName,
        traversal: 'dirty-and-down',
        executor: execN,
        routes: ['z.*'],
      },
      {
        name: 'new-1' as PhaseName,
        traversal: 'all',
        executor: vi.fn(),
        routes: ['w.*'],
      },
    ])

    // старые фазы удалены
    expect(raph.getPhase('old-1' as PhaseName)).toBeUndefined()
    expect(raph.getPhase('old-2' as PhaseName)).toBeUndefined()

    // новые фазы существуют в новом порядке
    expect(raph.phases.map((p) => p.name)).toEqual(['new-2', 'new-1'])
    expect(raph.getPhase('new-2' as PhaseName)).toBeDefined()
    expect(raph.getPhase('new-2' as PhaseName)!.executor).toBe(execN)
  })

  it('принимает фазы с пустым массивом routes', () => {
    const raph = new RaphApp()

    raph.definePhases([
      {
        name: 'no-routes' as PhaseName,
        traversal: 'dirty-only',
        executor: vi.fn(),
        routes: [],
      },
    ])

    const phase = raph.getPhase('no-routes' as PhaseName)
    expect(phase).toBeDefined()
    expect(phase!.routes).toEqual([])
  })

  it('разрешает дублирующиеся имена, но карта указывает на последнюю определённую', () => {
    const raph = new RaphApp()

    const exec1 = vi.fn()
    const exec2 = vi.fn()

    raph.definePhases([
      {
        name: 'dup' as PhaseName,
        traversal: 'dirty-only',
        executor: exec1,
        routes: ['a.*'],
      },
      {
        name: 'dup' as PhaseName,
        traversal: 'all',
        executor: exec2,
        routes: ['b.*'],
      },
    ])

    // массив хранит обе; карта должна содержать последнюю по имени
    expect(raph.phases.length).toBe(2)
    expect(raph.phases[0].executor).toBe(exec1)
    expect(raph.phases[1].executor).toBe(exec2)

    const fromMap = raph.getPhase('dup' as PhaseName)
    expect(fromMap).toBeDefined()
    expect(fromMap!.executor).toBe(exec2)
    expect(fromMap!.traversal).toBe('all')
  })
})
