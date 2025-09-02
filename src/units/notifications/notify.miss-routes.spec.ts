import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RaphApp } from '@/domain/core/RaphApp'
import { SchedulerType } from '@/domain/types/base.types'
import type { PhaseName } from '@/domain/types/phase.types'
import { RaphNode } from '@/domain/core/RaphNode'

describe('RaphApp notify – miss routes', () => {
  let raph: RaphApp
  const execA = vi.fn()
  const execB = vi.fn()

  beforeEach(() => {
    raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })
    execA.mockClear()
    execB.mockClear()
  })

  it('не запускает each, если ни один route не совпал', () => {
    raph.definePhases([
      {
        name: 'phaseA' as PhaseName,
        traversal: 'dirty-only',
        each: execA,
        routes: ['foo.*'], // не совпадёт с com.*
      },
    ])

    const n = new RaphNode(raph, { id: 'n' })
    raph.addNode(n)
    raph.track(n, 'com.*')

    raph.set('com.x', 1)

    expect(execA).not.toHaveBeenCalled()
  })

  it('не запускает each, если phase.routes пустые', () => {
    raph.definePhases([
      {
        name: 'phaseA' as PhaseName,
        traversal: 'dirty-only',
        each: execA,
        routes: [], // явно ничего не матчится
      },
    ])

    const n = new RaphNode(raph, { id: 'n' })
    raph.addNode(n)
    raph.track(n, 'com.*')

    raph.set('com.x', 1)

    expect(execA).not.toHaveBeenCalled()
  })

  it('не запускает each, если есть фаза с совпадением и фаза без совпадения — срабатывает только совпавшая', () => {
    raph.definePhases([
      {
        name: 'phaseA' as PhaseName,
        traversal: 'dirty-only',
        each: execA,
        routes: ['foo.*'], // miss
      },
      {
        name: 'phaseB' as PhaseName,
        traversal: 'dirty-only',
        each: execB,
        routes: ['com.*'], // hit
      },
    ])

    const n = new RaphNode(raph, { id: 'n' })
    raph.addNode(n)
    raph.track(n, 'com.*')

    raph.set('com.y', 2)

    expect(execA).not.toHaveBeenCalled()
    expect(execB).toHaveBeenCalled()
  })

  it('матчится при несовпадении глубины, если нет хвостовой ** (последняя *)', () => {
    raph.definePhases([
      {
        name: 'phaseA' as PhaseName,
        traversal: 'dirty-only',
        each: execA,
        routes: ['com.*'], // по нашей реализации: * в середине — один сегмент
      },
    ])

    const n = new RaphNode(raph, { id: 'n' })
    raph.addNode(n)
    raph.track(n, 'com.*')

    raph.set('com.x.y', 3)

    expect(execA).toHaveBeenCalled()
  })

  it('маршрут с параметрами не матчится, если параметр не совпал', () => {
    raph.definePhases([
      {
        name: 'phaseA' as PhaseName,
        traversal: 'dirty-only',
        each: execA,
        routes: ['list[*]'], // допустим, фазе нужен любой элемент, но нода подписана на конкретный id
      },
    ])

    const n = new RaphNode(raph, { id: 'n' })
    raph.addNode(n)
    raph.track(n, 'list[id="5"].*') // нода ждёт id=5

    // Изменение по другому id
    raph.set('list[id="7"].name', 'X')

    // Фаза слушает list[*] (любой элемент), но нода зависит от id=5.
    // each должен вызываться только при попадании в phase.routes,
    // здесь роуты фазы попадут, но dirty узлов по depIndex не набралось -> each не зовётся.
    expect(execA).not.toHaveBeenCalled()
  })

  it('несколько фаз — ни одна не матчится', () => {
    raph.definePhases([
      {
        name: 'phaseA' as PhaseName,
        traversal: 'dirty-only',
        each: execA,
        routes: ['alpha.*'],
      },
      {
        name: 'phaseB' as PhaseName,
        traversal: 'dirty-only',
        each: execB,
        routes: ['beta.*'],
      },
    ])

    const n = new RaphNode(raph, { id: 'n' })
    raph.addNode(n)
    raph.track(n, 'com.*')

    raph.set('com.z', 10)

    expect(execA).not.toHaveBeenCalled()
    expect(execB).not.toHaveBeenCalled()
  })
})
