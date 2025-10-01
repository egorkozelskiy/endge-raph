import { describe, it, expect } from 'vitest'
import { DefaultDataAdapter } from '@/domain/entities/DataAdapter'

describe('DefaultDataAdapter — простые корректностные тесты get/set с именованным индексом', () => {
  it('set по Param: com[id=<id>].x затем get возвращает то же значение (indexEnabled=false)', () => {
    const SIZE = 1000
    const com = Array.from({ length: SIZE }, (_, i) => ({ id: i, x: 0 }))
    const a = new DefaultDataAdapter({ com }, { indexEnabled: false })

    a.set('com[id=123].x', 777)
    expect(a.get('com[id=123].x')).toBe(777)

    a.set('com[id=0].x', 42)
    expect(a.get('com[id=0].x')).toBe(42)

    a.set('com[id=999].x', -5)
    expect(a.get('com[id=999].x')).toBe(-5)
  })

  it('set по Param: com[id=<id>].x затем get возвращает то же значение (indexEnabled=true)', () => {
    const SIZE = 1000
    const com = Array.from({ length: SIZE }, (_, i) => ({ id: i, x: 0 }))
    const a = new DefaultDataAdapter({ com }, { indexEnabled: true })

    a.set('com[id=123].x', 777)
    expect(a.get('com[id=123].x')).toBe(777)

    a.set('com[id=0].x', 42)
    expect(a.get('com[id=0].x')).toBe(42)

    a.set('com[id=999].x', -5)
    expect(a.get('com[id=999].x')).toBe(-5)
  })

  it('indexEnabled=true и indexEnabled=false дают одинаковый результат для набора записей', () => {
    const SIZE = 2000
    const makeData = () =>
      Array.from({ length: SIZE }, (_, i) => ({ id: i, x: 0 }))

    const aNoIdx = new DefaultDataAdapter(
      { com: makeData() },
      { indexEnabled: false },
    )
    const aIdx = new DefaultDataAdapter(
      { com: makeData() },
      { indexEnabled: true },
    )

    // серия записей в случайные id
    const ids = [0, 1, 2, 3, 10, 57, 199, 777, 1234, 1999]
    for (const id of ids) {
      aNoIdx.set(`com[id=${id}].x`, id * 10)
      aIdx.set(`com[id=${id}].x`, id * 10)
    }

    // проверяем, что чтения совпадают
    for (const id of ids) {
      expect(aNoIdx.get(`com[id=${id}].x`)).toBe(id * 10)
      expect(aIdx.get(`com[id=${id}].x`)).toBe(id * 10)
    }
  })

  it('autoCreate=true: set по несуществующему [id=…] создаёт элемент', () => {
    const a = new DefaultDataAdapter(
      { com: [] },
      { autoCreate: true, indexEnabled: true },
    )
    a.set('com[id=101].x', 5)

    // элемент создан, x установлен, id проставлен/сохранён
    expect(a.get('com[id=101].x')).toBe(5)
    const arr = a.get('com') as any[]
    const created = arr.find((el) => el?.id === 101)
    expect(created).toBeTruthy()
    expect(created.x).toBe(5)
  })

  it('autoCreate=false: set по несуществующему [id=…] бросает ошибку', () => {
    const a = new DefaultDataAdapter(
      { com: [] },
      { autoCreate: false, indexEnabled: true },
    )
    expect(() => a.set('com[id=5].x', 1)).toThrow()
  })

  it('delete по Param удаляет элемент: последующий get возвращает undefined', () => {
    const a = new DefaultDataAdapter(
      {
        com: [
          { id: 1, x: 10 },
          { id: 2, x: 20 },
        ],
      },
      { indexEnabled: true },
    )

    expect(a.get('com[id=2].x')).toBe(20)
    a.delete('com[id=2]')
    expect(a.get('com[id=2].x')).toBeUndefined()
    // соседний элемент не затронут
    expect(a.get('com[id=1].x')).toBe(10)
  })

  it('замена по позиционному индексу не ломает чтение по Param', () => {
    // важный кейс: лист Index меняет элемент напрямую; индексы должны инвалидироваться и перестроиться лениво
    const a = new DefaultDataAdapter(
      {
        com: [
          { id: 1, x: 10 },
          { id: 2, x: 20 },
          { id: 3, x: 30 },
        ],
      },
      { indexEnabled: true },
    )

    // прогреем индекс
    expect(a.get('com[id=2].x')).toBe(20)

    // заменим элемент по индексу 1 (там был id=2), теперь там новый объект с тем же id
    a.set('com[1]', { id: 2, x: 999 })

    // чтение по Param должно найти новый объект и корректно прочитать x
    expect(a.get('com[id=2].x')).toBe(999)
  })

  it('merge заменяет объект, если целевое значение не object; merge поверх object сохраняет ключи', () => {
    const a = new DefaultDataAdapter({ com: { x: 1, y: 2 } })
    a.merge('com', { z: 3 })
    expect(a.get('com')).toEqual({ x: 1, y: 2, z: 3 })

    const b = new DefaultDataAdapter({ com: 7 })
    b.merge('com', { z: 3 })
    expect(b.get('com')).toEqual({ z: 3 })
  })
})
