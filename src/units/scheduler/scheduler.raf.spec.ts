import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RaphApp } from '@/domain/core/RaphApp'
import { SchedulerType } from '@/domain/types/base.types'
import type {
  PhaseExecutorContext,
  PhaseName,
} from '@/domain/types/phase.types'
import { RaphNode } from '@/domain/core/RaphNode'

describe('RaphApp.scheduler-raf', () => {
  let rafSpy: ReturnType<typeof vi.fn>
  let cafSpy: ReturnType<typeof vi.fn>
  let realRAF: typeof globalThis.requestAnimationFrame | undefined
  let realCAF: typeof globalThis.cancelAnimationFrame | undefined

  beforeEach(() => {
    vi.useFakeTimers()

    // Сохраняем настоящие raf/caf, чтобы восстановить позже
    realRAF = globalThis.requestAnimationFrame
    realCAF = globalThis.cancelAnimationFrame

    // Полифиллим RAF через setTimeout, чтобы фейковые таймеры могли им управлять
    rafSpy = vi.fn((cb: FrameRequestCallback) => {
      const id = setTimeout(() => cb(performance.now()), 16)
      return id as unknown as number
    })
    cafSpy = vi.fn((id: number) =>
      clearTimeout(id as unknown as NodeJS.Timeout),
    )

    // @ts-expect-error тестовый полифилл
    globalThis.requestAnimationFrame = rafSpy
    // @ts-expect-error тестовый полифилл
    globalThis.cancelAnimationFrame = cafSpy
  })

  afterEach(() => {
    // @ts-expect-error восстановление
    globalThis.requestAnimationFrame = realRAF
    // @ts-expect-error восстановление
    globalThis.cancelAnimationFrame = realCAF
    vi.useRealTimers()
  })

  it('executes phase on the next animation frame (not immediately)', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.AnimationFrame })

    const calls: Array<{ phase: string; node: string }> = []

    raph.definePhases([
      {
        name: 'raf-phase' as PhaseName,
        traversal: 'dirty-only',
        each: (ctx: PhaseExecutorContext) => {
          calls.push({ phase: ctx.phase as string, node: ctx.node.id })
        },
        routes: ['scene.*'],
      },
    ])

    const n = new RaphNode(raph, { id: 'n1' })
    raph.addNode(n)
    raph.track(n, 'scene.*')

    // Изменяем данные -> должно запланироваться через RAF, но пока не выполнено
    raph.set('scene.foo', 1)
    expect(calls.length).toBe(0)
    expect(rafSpy).toHaveBeenCalled()

    // Продвигаем меньше, чем кадр -> всё ещё не выполнено
    vi.advanceTimersByTime(15)
    expect(calls.length).toBe(0)

    // Продвигаем до кадра -> each должен выполниться
    vi.advanceTimersByTime(1)
    expect(calls.length).toBe(1)
    expect(calls[0]).toEqual({ phase: 'raf-phase', node: 'n1' })
  })

  it('coalesces multiple notifications into a single frame', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.AnimationFrame })

    const exec = vi.fn()

    raph.definePhases([
      {
        name: 'raf-phase' as PhaseName,
        traversal: 'dirty-only',
        each: exec,
        routes: ['items.*'],
      },
    ])

    const n = new RaphNode(raph, { id: 'nodeA' })
    raph.addNode(n)
    raph.track(n, 'items.*')

    // Несколько изменений до наступления кадра
    raph.set('items.a', 1)
    raph.set('items.b', 2)
    raph.merge('items.c', { x: 1 })
    raph.delete('items.b')

    // Пока ничего не выполнено
    expect(exec).not.toHaveBeenCalled()

    // Один кадр -> должно выполниться один раз для узла (без дублирования)
    vi.advanceTimersByTime(16)
    expect(exec).toHaveBeenCalledTimes(1)
    const ctx = exec.mock.calls[0][0] as PhaseExecutorContext
    expect(ctx.node.id).toBe('nodeA')
    expect(ctx.phase).toBe('raf-phase')
  })

  it('schedules a new frame after each dirty mark, but still batches work per frame', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.AnimationFrame })

    const exec = vi.fn()
    raph.definePhases([
      {
        name: 'raf-phase' as PhaseName,
        traversal: 'dirty-only',
        each: exec,
        routes: ['app.*'],
      },
    ])

    const a = new RaphNode(raph, { id: 'A' })
    const b = new RaphNode(raph, { id: 'B' })
    raph.addNode(a)
    raph.addNode(b)
    raph.track(a, 'app.*')
    raph.track(b, 'app.*')

    // Помечаем оба как dirty до кадра
    raph.set('app.one', 1)
    raph.set('app.two', 2)

    // Для обоих изменений должен быть только один кадр
    expect(rafSpy).toHaveBeenCalled()
    const rafCallsBefore = rafSpy.mock.calls.length

    vi.advanceTimersByTime(16)

    // Executor вызван для обоих узлов (порядок может отличаться)
    expect(exec.mock.calls.length).toBe(2)
    const seen = new Set(
      exec.mock.calls.map((c) => (c[0] as PhaseExecutorContext).node.id),
    )
    expect(seen).toEqual(new Set(['A', 'B']))

    // Новое изменение -> планируется ещё один кадр
    raph.set('app.three', 3)
    expect(rafSpy.mock.calls.length).toBeGreaterThanOrEqual(rafCallsBefore + 1)
  })

  it('respects traversal=dirty-and-down under RAF', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.AnimationFrame })

    const exec = vi.fn()

    raph.definePhases([
      {
        name: 'raf-phase' as PhaseName,
        traversal: 'dirty-and-down',
        each: exec,
        routes: ['root.*'],
      },
    ])

    const l1 = new RaphNode(raph, { id: 'l1' })
    const l2a = new RaphNode(raph, { id: 'l2a' })
    const l2b = new RaphNode(raph, { id: 'l2b' })
    const l3 = new RaphNode(raph, { id: 'l3' })

    raph.addNode(l1)
    l1.addChild(l2a)
    l1.addChild(l2b)
    l2a.addChild(l3)

    // Трекаем только l1 как источник dirty
    raph.track(l1, 'root.*')

    // Изменение -> l1 становится dirty; проход должен включать l1 + всех потомков
    raph.set('root.changed', true)

    vi.advanceTimersByTime(16)

    const handled = new Set(
      exec.mock.calls.map((c) => (c[0] as PhaseExecutorContext).node.id),
    )
    expect(handled).toEqual(new Set(['l1', 'l2a', 'l2b', 'l3']))
  })
})
