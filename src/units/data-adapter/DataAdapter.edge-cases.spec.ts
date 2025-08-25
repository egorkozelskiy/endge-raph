import { describe, it, expect } from 'vitest'
import { DefaultDataAdapter } from '@/domain/entities/DataAdapter'
import { DataPath } from '@/domain/entities/DataPath'

describe('DefaultDataAdapter edge cases', () => {
  it('должен кидать ошибку при get с wildcard без параметров', () => {
    const adapter = new DefaultDataAdapter({ com: [] })
    expect(() => adapter.get('com[*]')).toThrow()
  })

  it('должен кидать ошибку при set с wildcard без параметров', () => {
    const adapter = new DefaultDataAdapter({ com: [] })
    expect(() => adapter.set('com[*]', 1)).toThrow()
  })

  it('должен кидать ошибку при set wildcard без массива', () => {
    const adapter = new DefaultDataAdapter({ com: {} })
    expect(() => adapter.set('com[*][id=5]', 1)).toThrow()
  })

  it('должен кидать ошибку при set листового wildcard с не-объектом', () => {
    const adapter = new DefaultDataAdapter({ com: [{ id: 1 }] })
    expect(() => adapter.set('com[id=1]', 123)).toThrow()
  })

  it('должен кидать ошибку при delete с wildcard без параметров', () => {
    const adapter = new DefaultDataAdapter({ com: [] })
    expect(() => adapter.delete('com[*]')).toThrow()
  })

  it('должен корректно удалять элемент массива при arrayDelete=splice', () => {
    const adapter = new DefaultDataAdapter(
      { com: [{ id: 1 }, { id: 2 }] },
      { arrayDelete: 'splice' },
    )
    adapter.delete('com[id=1]')
    expect(adapter.root().com).toEqual([{ id: 2 }])
  })

  it('должен корректно удалять элемент массива при arrayDelete=unset', () => {
    const adapter = new DefaultDataAdapter(
      { com: [{ id: 1 }, { id: 2 }] },
      { arrayDelete: 'unset' },
    )
    adapter.delete('com[id=1]')
    expect(adapter.root().com[0]).toBeUndefined()
    expect(adapter.root().com[1]).toEqual({ id: 2 })
  })

  it('должен корректно мержить объект', () => {
    const adapter = new DefaultDataAdapter({ com: { x: 1, y: 2 } })
    adapter.merge('com', { z: 3 })
    expect(adapter.root().com).toEqual({ x: 1, y: 2, z: 3 })
  })

  it('должен выполнять set для не-объекта при merge', () => {
    const adapter = new DefaultDataAdapter({ com: 5 })
    adapter.merge('com', { z: 3 })
    expect(adapter.root().com).toEqual({ z: 3 })
  })

  it('должен кидать ошибку при get wildcard не на массиве', () => {
    const adapter = new DefaultDataAdapter({ com: {} })
    expect(() => adapter.get('com[id=5]')).toThrow()
  })

  it('должен кидать ошибку при set target container null и autoCreate=false', () => {
    const adapter = new DefaultDataAdapter({}, { autoCreate: false })
    expect(() => adapter.set('com.x', 1)).toThrow()
  })

  it('должен кидать ошибку при set wildcard элемент не найден и autoCreate=false', () => {
    const adapter = new DefaultDataAdapter({ com: [] }, { autoCreate: false })
    expect(() => adapter.set('com[id=1].x', 1)).toThrow()
  })

  it('должен возвращать undefined при get несуществующего пути', () => {
    const adapter = new DefaultDataAdapter({})
    expect(adapter.get('com.x')).toBeUndefined()
  })

  it('должен заменять весь root при set пустого пути', () => {
    const adapter = new DefaultDataAdapter({})
    adapter.set('', { hello: 'world' })
    expect(adapter.root()).toEqual({ hello: 'world' })
  })

  it('должен удалять весь root при delete пустого пути', () => {
    const adapter = new DefaultDataAdapter({ x: 1 })
    adapter.delete('')
    expect(adapter.root()).toEqual({})
  })

  it('должен корректно работать с DataPath объектом', () => {
    const adapter = new DefaultDataAdapter({})
    const dp = DataPath.from('com.x')
    adapter.set(dp, 42)
    expect(adapter.get(dp)).toBe(42)
  })
})
