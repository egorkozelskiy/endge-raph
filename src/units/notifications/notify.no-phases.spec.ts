import { describe, it, expect } from 'vitest'
import { SchedulerType } from '@/domain/types/base.types'
import { RaphApp } from '@/domain/core/RaphApp'
import { RaphNode } from '@/domain/core/RaphNode'

describe('RaphApp.notify (без фаз)', () => {
  it('не планирует и не выполняет ничего; CRUD всё ещё работает', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })

    // фазы вообще не определены
    expect(raph.phases.length).toBe(0)

    // строим маленький граф + подписки (должны игнорироваться, т.к. фаз нет)
    const n1 = new RaphNode(raph, { id: 'n1' })
    const n2 = new RaphNode(raph, { id: 'n2' })
    raph.addNode(n1)
    raph.addNode(n2)
    raph.track(n1, 'com.*')
    raph.track(n2, 'data.*')

    // set() должен обновлять dataAdapter, но не пытаться выполнять фазы
    raph.set('com.x', 1)
    raph.set('data.y', 2)
    expect(raph.dataAdapter.root()).toEqual({ com: { x: 1 }, data: { y: 2 } })

    // notify() без фаз — no-op (без ошибок, без изменений)
    raph.notify('com.x', 'set', 3) // не меняет данные; просто сигнал
    // Данные остаются такими, как после set()
    expect(raph.dataAdapter.root()).toEqual({ com: { x: 1 }, data: { y: 2 } })

    // run() без фаз тоже ничего не делает и не бросает ошибок
    expect(() => raph.run()).not.toThrow()
  })

  it('notify сам по себе не мутирует данные, если нет фаз', () => {
    const raph = new RaphApp()
    raph.options({ scheduler: SchedulerType.Sync })

    // Фазы не объявлены
    const n = new RaphNode(raph, { id: 'n' })
    raph.addNode(n)
    raph.track(n, 'com[id=5].*')

    // Прямой notify не должен менять содержимое dataAdapter
    expect(raph.dataAdapter.root()).toEqual({})
    raph.notify('com[id=5].x', 'set', 123)
    expect(raph.dataAdapter.root()).toEqual({})
  })
})
