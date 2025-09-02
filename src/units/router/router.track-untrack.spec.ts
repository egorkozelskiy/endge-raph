import { describe, it, expect } from 'vitest'
import { RaphApp } from '@/domain/core/RaphApp'
import { RaphNode } from '@/domain/core/RaphNode'
import type { PhaseName } from '@/domain/types/phase.types'

describe('RaphApp track/untrack (router-based)', () => {
  function makeRaphWithPhase(route: string) {
    const raph = new RaphApp()
    const fired: RaphNode[] = []

    raph.definePhases([
      {
        name: 'T' as PhaseName,
        routes: [route], // фаза интересуется этим маршрутом
        traversal: 'dirty-only', // берём ровно те ноды, которые дал роутер
        each: ({ node }) => {
          fired.push(node)
        },
      },
    ])
    return { raph, fired }
  }

  it('должен регистрировать зависимость узла от пути', () => {
    const { raph, fired } = makeRaphWithPhase('com.x')
    const node = new RaphNode(raph, { id: 'n1' })
    raph.addNode(node)

    raph.track(node, 'com.x')

    // триггерим событие по этому же пути
    raph.set('com.x', 1)
    expect(fired).toContain(node)
  })

  it('должен снимать одну зависимость', () => {
    const { raph, fired } = makeRaphWithPhase('com.x')
    const node = new RaphNode(raph, { id: 'n1' })
    raph.addNode(node)

    raph.track(node, 'com.x')
    raph.untrack(node, 'com.x')

    raph.set('com.x', 1)
    expect(fired).toHaveLength(0)
  })

  it('должен снимать все зависимости при вызове без аргумента', () => {
    const { raph, fired } = makeRaphWithPhase('com.*') // фаза ловит любые com.*
    const node = new RaphNode(raph, { id: 'n1' })
    raph.addNode(node)

    raph.track(node, 'com.x')
    raph.track(node, 'com.y')

    raph.untrack(node)

    raph.set('com.x', 1)
    raph.set('com.y', 2)
    expect(fired).toHaveLength(0)
  })

  it('untrack не должен падать, если зависимость не найдена', () => {
    const { raph } = makeRaphWithPhase('com.x')
    const node = new RaphNode(raph, { id: 'n1' })
    raph.addNode(node)

    expect(() => raph.untrack(node, 'not.exists')).not.toThrow()
  })

  it('track должен добавлять один и тот же узел в несколько масок', () => {
    // фаза слушает оба маршрута, чтобы удобнее считать срабатывания
    const raph = new RaphApp()
    const fired: Array<{ path: string; node: RaphNode }> = []

    raph.definePhases([
      {
        name: 'T' as PhaseName,
        routes: ['com.x', 'data.y'],
        traversal: 'dirty-only',
        each: ({ node }) => {
          // each не знает путь, но мы будем дергать notify/set по одному за раз
          fired.push({ path: '<fired>', node })
        },
      },
    ])

    const node = new RaphNode(raph, { id: 'n1' })
    raph.addNode(node)

    raph.track(node, 'com.x')
    raph.track(node, 'data.y')

    // событие по com.x
    raph.set('com.x', 1)
    expect(fired.some((f) => f.node === node)).toBe(true)

    // сбросим фиксацию и проверим второй маршрут
    fired.length = 0
    raph.set('data.y', 2)
    expect(fired.some((f) => f.node === node)).toBe(true)
  })

  it('untrack должен удалять узел из всех масок, если dep не указан', () => {
    const { raph, fired } = makeRaphWithPhase('com.*') // слушаем все com.*
    const node = new RaphNode(raph, { id: 'n1' })
    raph.addNode(node)

    raph.track(node, 'com.x')
    raph.track(node, 'com.z')

    // снимаем все
    raph.untrack(node)

    raph.set('com.x', 1)
    raph.set('com.z', 2)
    expect(fired).toHaveLength(0)
  })
})
