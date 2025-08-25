import { describe, it, expect, vi } from 'vitest'
import { RaphApp } from '@/domain/core/RaphApp'
import type {
  PhaseExecutorContext,
  PhaseName,
} from '@/domain/types/phase.types'
import { RaphNode } from '@/domain/core/RaphNode'
import { SchedulerType } from '@/domain/types/base.types'

function getPhaseDirty(app: RaphApp, name: PhaseName) {
  const dirty = (app as any)._dirty as Map<
    PhaseName,
    { buckets: Map<number, RaphNode[]>; heap: any; inHeap: Set<number> }
  >
  return dirty.get(name)
}

// depth=0 (без рёбер) - приоритет монотонно убывает с ростом weight.
// Если в коде приоритет = depth*weightLimit - weight, то при depth=0 индекс = -weight.
const findBucketIndex = (q: ReturnType<typeof getPhaseDirty>, n: RaphNode) => {
  for (const [idx, arr] of q!.buckets) if (arr.includes(n)) return idx
  return undefined
}

describe('RaphApp.dirty-buckets (Map + MinHeap)', () => {
  it('складывает ноды в buckets по индексу приоритета; heap/inHeap получают индекс бакета (lazy alloc)', () => {
    const app = new RaphApp()
    app.options({ scheduler: SchedulerType.Microtask })

    const PHASE = 'test-phase' as PhaseName
    app.definePhases([
      {
        name: PHASE,
        traversal: 'dirty-only',
        executor: (_ctx: PhaseExecutorContext) => {},
        routes: ['*'],
      },
    ])

    const n1 = new RaphNode(app, { id: 'n1', weight: 2 })
    const n2 = new RaphNode(app, { id: 'n2', weight: 7 })
    app.addNode(n1)
    app.addNode(n2)

    app.dirty(PHASE, n1)
    app.dirty(PHASE, n2)

    const q = getPhaseDirty(app, PHASE)!
    expect(q).toBeTruthy()
    expect(q.buckets instanceof Map).toBe(true)

    const i1 = findBucketIndex(q, n1)!
    const i2 = findBucketIndex(q, n2)!
    expect(i1).not.toBeUndefined()
    expect(i2).not.toBeUndefined()

    expect(q.buckets.get(i1)!.includes(n1)).toBe(true)
    expect(q.buckets.get(i2)!.includes(n2)).toBe(true)

    // индексы должны быть в inHeap и отражаться на вершине кучи
    expect(q.inHeap.has(i1)).toBe(true)
    expect(q.inHeap.has(i2)).toBe(true)
    const top = q.heap.peek()
    expect([i1, i2]).toContain(top)
  })

  it('не дублирует одну и ту же ноду при повторном dirty (бит-маска)', () => {
    const app = new RaphApp()
    app.options({ scheduler: SchedulerType.Microtask })

    const PHASE = 'phase-dupe' as PhaseName
    app.definePhases([
      {
        name: PHASE,
        traversal: 'dirty-only',
        executor: (_ctx: PhaseExecutorContext) => {},
        routes: ['*'],
      },
    ])

    const n = new RaphNode(app, { id: 'n', weight: 3 })
    app.addNode(n)

    app.dirty(PHASE, n)
    app.dirty(PHASE, n)
    app.dirty(PHASE, n)

    const q = getPhaseDirty(app, PHASE)!
    const idx = findBucketIndex(q, n)!
    const arr = q.buckets.get(idx)!
    expect(arr.filter((x) => x === n).length).toBe(1)
  })

  it('кладёт несколько нод в один и тот же бакет, если их индексы совпадают', () => {
    const app = new RaphApp()
    app.options({ scheduler: SchedulerType.Microtask })

    const PHASE = 'phase-same-bucket' as PhaseName
    app.definePhases([
      {
        name: PHASE,
        traversal: 'dirty-only',
        executor: (_ctx: PhaseExecutorContext) => {},
        routes: ['*'],
      },
    ])

    // одинаковый weight при depth=0 - одинаковый индекс
    const a = new RaphNode(app, { id: 'a', weight: 0 })
    const b = new RaphNode(app, { id: 'b', weight: 0 })
    app.addNode(a)
    app.addNode(b)

    app.dirty(PHASE, a)
    app.dirty(PHASE, b)

    const q = getPhaseDirty(app, PHASE)!
    const idx = findBucketIndex(q, a)!
    expect(idx).toBe(findBucketIndex(q, b))
    const bucket = q.buckets.get(idx)!
    expect(bucket.includes(a)).toBe(true)
    expect(bucket.includes(b)).toBe(true)
    expect(bucket.length).toBe(2)
  })

  it('unknown phase: dirty() ничего не попадает в очередь исполнения (фазы нет в _phasesArray)', () => {
    const app = new RaphApp()
    app.options({ scheduler: SchedulerType.Sync })

    const n = new RaphNode(app, { id: 'n' })
    app.addNode(n)

    const exec = vi.fn((_ctx: PhaseExecutorContext) => {})
    app.definePhases([
      {
        name: 'defined' as PhaseName,
        traversal: 'dirty-only',
        executor: exec,
        routes: ['*'],
      },
    ])

    app.dirty('unknown-phase' as PhaseName, n)
    app.run()
    expect(exec).not.toHaveBeenCalled()
  })

  it('notify() через router раскладывает ноды в buckets; heap/inHeap живут до run()', () => {
    const app = new RaphApp()
    app.options({ scheduler: SchedulerType.Microtask })

    const PHASE = 'phase-route' as PhaseName
    const exec = vi.fn((_ctx: PhaseExecutorContext) => {})
    app.definePhases([
      {
        name: PHASE,
        traversal: 'dirty-only',
        executor: exec,
        routes: ['com.*'],
      },
    ])

    const n1 = new RaphNode(app, { id: 'n1' })
    const n2 = new RaphNode(app, { id: 'n2' })
    app.addNode(n1)
    app.addNode(n2)

    app.track(n1, 'com.*')
    app.track(n2, 'com[id=2].*')

    app.notify('com[id=2].x')

    const q = getPhaseDirty(app, PHASE)!
    const i1 = findBucketIndex(q, n1)!
    const i2 = findBucketIndex(q, n2)!
    expect(q.buckets.get(i1)!.includes(n1)).toBe(true)
    expect(q.buckets.get(i2)!.includes(n2)).toBe(true)
    expect(q.heap.size).toBeGreaterThan(0)
    expect(exec).not.toHaveBeenCalled()
  })

  it('run() обрабатывает в порядке возрастания индекса (min-heap), затем очищает buckets/heap/inHeap', () => {
    const app = new RaphApp()
    app.options({ scheduler: SchedulerType.Sync })

    const PHASE = 'phase-order' as PhaseName
    const order: string[] = []
    app.definePhases([
      {
        name: PHASE,
        traversal: 'dirty-only',
        executor: ({ node }: PhaseExecutorContext) => order.push(node.id),
        routes: ['*'],
      },
    ])

    const a = new RaphNode(app, { id: 'a', weight: 5 })
    const b = new RaphNode(app, { id: 'b', weight: 1 })
    const c = new RaphNode(app, { id: 'c', weight: 10 })
    app.addNode(a)
    app.addNode(b)
    app.addNode(c)

    // блокируем авто-run от invalidate()
    const saved = app.run
    ;(app as any).run = () => {}

    app.dirty(PHASE, a)
    app.dirty(PHASE, b)
    app.dirty(PHASE, c)
    ;(app as any).run = saved
    app.run()

    // depth=0: c(10) раньше a(5) раньше b(1)
    expect(order).toEqual(['c', 'a', 'b'])

    const q = getPhaseDirty(app, PHASE)!
    expect(q.buckets.size).toBe(0)
    expect(q.inHeap.size).toBe(0)
    expect(q.heap.size).toBe(0)
  })

  it('битмаска (__dirtyPhasesMask) ставится в dirty() и очищается после обработки', () => {
    const app = new RaphApp()
    app.options({ scheduler: SchedulerType.Sync })

    const PHASE = 'phase-bit' as PhaseName
    app.definePhases([
      {
        name: PHASE,
        traversal: 'dirty-only',
        executor: (_ctx: PhaseExecutorContext) => {},
        routes: ['*'],
      },
    ])

    const n = new RaphNode(app, { id: 'n' })
    app.addNode(n)

    expect(n['__dirtyPhasesMask'] | 0).toBe(0)

    const saved = app.run
    ;(app as any).run = () => {}

    app.dirty(PHASE, n)
    const maskAfterDirty = n['__dirtyPhasesMask'] | 0
    expect(maskAfterDirty).not.toBe(0)
    ;(app as any).run = saved
    app.run()

    const maskAfterRun = (n as any)['__dirtyPhasesMask'] | 0
    expect(maskAfterRun).toBe(0)
  })

  it('traversal "dirty-and-down": notify расширяет набор вниз по рёбрам графа', () => {
    const app = new RaphApp()
    app.options({ scheduler: SchedulerType.Microtask })

    const PHASE = 'phase-down' as PhaseName
    const exec = vi.fn((_ctx: PhaseExecutorContext) => {})
    app.definePhases([
      {
        name: PHASE,
        traversal: 'dirty-and-down',
        executor: exec,
        routes: ['com.*'],
      },
    ])

    const src = new RaphNode(app, { id: 'src' })
    const dep = new RaphNode(app, { id: 'dep' })
    app.addNode(src)
    app.addNode(dep)

    app.addDependency(src, dep)
    app.track(src, 'com[id=1].*')

    app.notify('com[id=1].x')

    const q = getPhaseDirty(app, PHASE)!
    const all = Array.from(q.buckets.values()).flat()
    expect(all.some((n) => n.id === 'src')).toBe(true)
    expect(all.some((n) => n.id === 'dep')).toBe(true)
  })
})
