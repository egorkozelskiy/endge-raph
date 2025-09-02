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
        each: execA,
        routes: ['x.*'],
      },
      {
        name: 'phase-B' as PhaseName,
        traversal: 'all',
        each: execB,
        routes: ['y.*'],
      },
    ]

    raph.definePhases(phases)

    // порядок сохраняется в .phases
    expect(raph.phases.map((p) => p.name)).toEqual(['phase-A', 'phase-B'])
    // executors — те же самые ссылки
    expect(raph.phases[0].each).toBe(execA)
    expect(raph.phases[1].each).toBe(execB)
  })

  it('заполняет карту фаз для быстрого поиска по имени', () => {
    const raph = new RaphApp()

    const execA = vi.fn((ctx: PhaseExecutorContext) => {})
    const execB = vi.fn((ctx: PhaseExecutorContext) => {})

    raph.definePhases([
      {
        name: 'alpha' as PhaseName,
        traversal: 'dirty-only',
        each: execA,
        routes: ['a.*'],
      },
      {
        name: 'beta' as PhaseName,
        traversal: 'dirty-only',
        each: execB,
        routes: ['b.*'],
      },
    ])

    const alpha = raph.getPhase('alpha' as PhaseName)
    const beta = raph.getPhase('beta' as PhaseName)

    expect(alpha).toBeDefined()
    expect(beta).toBeDefined()
    expect(alpha!.each).toBe(execA)
    expect(beta!.each).toBe(execB)
  })

  it('заменяет ранее определённые фазы при повторном вызове', () => {
    const raph = new RaphApp()

    raph.definePhases([
      {
        name: 'old-1' as PhaseName,
        traversal: 'dirty-only',
        each: vi.fn(),
        routes: ['x.*'],
      },
      {
        name: 'old-2' as PhaseName,
        traversal: 'dirty-only',
        each: vi.fn(),
        routes: ['y.*'],
      },
    ])

    // переопределяем другим набором и порядком
    const execN = vi.fn()
    raph.definePhases([
      {
        name: 'new-2' as PhaseName,
        traversal: 'dirty-and-down',
        each: execN,
        routes: ['z.*'],
      },
      {
        name: 'new-1' as PhaseName,
        traversal: 'all',
        each: vi.fn(),
        routes: ['w.*'],
      },
    ])

    // старые фазы удалены
    expect(raph.getPhase('old-1' as PhaseName)).toBeUndefined()
    expect(raph.getPhase('old-2' as PhaseName)).toBeUndefined()

    // новые фазы существуют в новом порядке
    expect(raph.phases.map((p) => p.name)).toEqual(['new-2', 'new-1'])
    expect(raph.getPhase('new-2' as PhaseName)).toBeDefined()
    expect(raph.getPhase('new-2' as PhaseName)!.each).toBe(execN)
  })

  it('принимает фазы с пустым массивом routes', () => {
    const raph = new RaphApp()

    raph.definePhases([
      {
        name: 'no-routes' as PhaseName,
        traversal: 'dirty-only',
        each: vi.fn(),
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
        each: exec1,
        routes: ['a.*'],
      },
      {
        name: 'dup' as PhaseName,
        traversal: 'all',
        each: exec2,
        routes: ['b.*'],
      },
    ])

    // массив хранит обе; карта должна содержать последнюю по имени
    expect(raph.phases.length).toBe(2)
    expect(raph.phases[0].each).toBe(exec1)
    expect(raph.phases[1].each).toBe(exec2)

    const fromMap = raph.getPhase('dup' as PhaseName)
    expect(fromMap).toBeDefined()
    expect(fromMap!.each).toBe(exec2)
    expect(fromMap!.traversal).toBe('all')
  })
})
