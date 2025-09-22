import { describe, it, expect } from 'vitest'
import { DefaultDataAdapter } from '@/domain/entities/DataAdapter'
import { DataPath } from '@/domain/entities/DataPath'

describe('DefaultDataAdapter get/set/merge/delete', () => {
  it('должен устанавливать и получать простое значение', () => {
    const adapter = new DefaultDataAdapter({})
    adapter.set('com.x', 123)
    expect(adapter.get('com.x')).toBe(123)
  })

  it('должен автоматически создавать вложенные объекты', () => {
    const adapter = new DefaultDataAdapter({})
    adapter.set('a.b.c', 'value')
    expect(adapter.root()).toEqual({ a: { b: { c: 'value' } } })
  })

  it('должен автоматически создавать вложенные массивы для числовых индексов', () => {
    const adapter = new DefaultDataAdapter({})
    adapter.set('rows[0].x', 10)
    expect(adapter.root()).toEqual({ rows: [{ x: 10 }] })
  })

  it('должен устанавливать значение в существующем массиве', () => {
    const adapter = new DefaultDataAdapter({ rows: [{ id: 1 }, { id: 2 }] })
    adapter.set('rows[1].x', 99)
    expect(adapter.root().rows[1].x).toBe(99)
  })

  it('должен работать с wildcard+params в set', () => {
    const adapter = new DefaultDataAdapter({ rows: [{ id: 5 }] })
    adapter.set('rows[id=5].status', 'ok')
    expect(adapter.root().rows[0].status).toBe('ok')
  })

  it('должен создавать новый элемент массива по wildcard+params', () => {
    const adapter = new DefaultDataAdapter({ rows: [] })
    adapter.set('rows[id=7].status', 'active')
    expect(adapter.root().rows[0]).toEqual({ id: 7, status: 'active' })
  })

  it('должен получать значение через get с wildcard+params', () => {
    const adapter = new DefaultDataAdapter({
      rows: [{ id: 3, value: 'hello' }],
    })
    expect(adapter.get('rows[id=3].value')).toBe('hello')
  })

  it('должен получать значение через get с params', () => {
    const adapter = new DefaultDataAdapter({
      rows: [{ id: 3, value: 'hello' }],
    })
    expect(
      adapter.get('$datas[id=$dataId].rowsId', {
        vars: {
          datas: [
            {
              id: 'data1',
              rowsId: 3,
            },
          ],
          dataId: 'data1',
        },
      }),
    ).toBe(3)
  })

  it('должен получать значение через get с params 2', () => {
    const adapter = new DefaultDataAdapter({
      FLT_ARR: {
        legs: [{ id: 'SU1045_220925_AER_1' }],
      },
    })
    expect(
      adapter.get('$store.legs[$i].id', {
        vars: {
          legs: [{ id: 'SU1045_220925_AER_1' }],
          i: 0,
          store: 'FLT_ARR',
        },
      }),
    ).toBe('SU1045_220925_AER_1')
  })

  it('должен получать значение через get с params_', () => {
    const adapter = new DefaultDataAdapter({
      rows: [{ id: 3, value: 'hello' }],
    })
    expect(
      adapter.get('rows[id=$datas[id=$dataId].rowsId].value', {
        vars: {
          datas: [
            {
              id: 'data1',
              rowsId: 3,
            },
          ],
          dataId: 'data1',
        },
      }),
    ).toBe('hello')
  })

  it('должен возвращать undefined если элемент не найден', () => {
    const adapter = new DefaultDataAdapter({
      rows: [{ id: 3, value: 'hello' }],
    })
    expect(adapter.get('rows[id=4].value')).toBeUndefined()
  })

  it('merge должен объединять объекты', () => {
    const adapter = new DefaultDataAdapter({ com: { a: 1, b: 2 } })
    adapter.merge('com', { b: 3, c: 4 })
    expect(adapter.root().com).toEqual({ a: 1, b: 3, c: 4 })
  })

  it('merge должен заменять значение, если target не объект', () => {
    const adapter = new DefaultDataAdapter({ com: 5 })
    adapter.merge('com', { new: 'obj' })
    expect(adapter.root().com).toEqual({ new: 'obj' })
  })

  it('delete должен удалять свойство объекта', () => {
    const adapter = new DefaultDataAdapter({ com: { x: 1, y: 2 } })
    adapter.delete('com.x')
    expect(adapter.root().com).toEqual({ y: 2 })
  })

  it('delete должен удалять элемент массива по индексу', () => {
    const adapter = new DefaultDataAdapter({ rows: [1, 2, 3] })
    adapter.delete('rows[1]')
    expect(adapter.root().rows[1]).toBeUndefined()
  })

  it('delete должен удалять элемент массива по индексу с arrayDelete=splice', () => {
    const adapter = new DefaultDataAdapter(
      { rows: [1, 2, 3] },
      { arrayDelete: 'splice' },
    )
    adapter.delete('rows[1]')
    expect(adapter.root().rows).toEqual([1, 3])
  })

  it('delete должен удалять элемент массива по wildcard+params', () => {
    const adapter = new DefaultDataAdapter({ rows: [{ id: 1 }, { id: 2 }] })
    adapter.delete('rows[id=2]')
    expect(adapter.root().rows[1]).toBeUndefined()
  })

  it('delete должен удалять элемент массива по wildcard+params с arrayDelete=splice', () => {
    const adapter = new DefaultDataAdapter(
      { rows: [{ id: 1 }, { id: 2 }] },
      { arrayDelete: 'splice' },
    )
    adapter.delete('rows[id=2]')
    expect(adapter.root().rows).toEqual([{ id: 1 }])
  })

  it('должен корректно работать с DataPath объектом', () => {
    const adapter = new DefaultDataAdapter({})
    const dp = DataPath.from('foo.bar')
    adapter.set(dp, 'baz')
    expect(adapter.get(dp)).toBe('baz')
    adapter.delete(dp)
    expect(adapter.get(dp)).toBeUndefined()
  })
})
