import { describe, it, expect } from 'vitest'
import { DataPath } from '@/domain/entities/DataPath'

describe('DataPath.fromString — wildcardDynamic', () => {
  it('подставляет известные vars и заменяет неизвестные на [*] (индекс) и * (ключ)', () => {
    const dp = DataPath.fromString('$store.legs[$i].carrier', {
      vars: { store: 'FLT_ARR' }, // $store известен
      wildcardDynamic: true, // $i неизвестен - wildcard
    })
    expect(dp.toStringPath()).toBe('FLT_ARR.legs[*].carrier')
  })

  it('нормализует сложный путь с параметрами: FK-для legId динамический → [*], имя атрибута строковый литерал сохраняется', () => {
    const dp = DataPath.fromString(
      '$store.attrs[legId=$store.legs[$i].id].items[name=\'STA\']',
      {
        vars: { store: 'FLT_ARR' }, // только $store известен
        wildcardDynamic: true,
      },
    )
    // ожидание: только динамические куски становятся wildcard'ами
    // имя 'STA' остаётся строковым литералом, toStringPath сериализует его в двойных кавычках
    expect(dp.toStringPath()).toBe('FLT_ARR.attrs[*].items[name="STA"]')
  })

  it('когда и $store, и $i заданы в vars — никаких wildcard, путь индексный', () => {
    const dp = DataPath.fromString('$store.legs[$i].carrier', {
      vars: { store: 'FLT_ARR', i: 3 },
      wildcardDynamic: true,
    })
    expect(dp.toStringPath()).toBe('FLT_ARR.legs[3].carrier')
  })

  it('параметры вида [id=$val] — подставляет литерал из vars (число без кавычек, строка в кавычках)', () => {
    const dpNum = DataPath.fromString('$store.rows[id=$val].x', {
      vars: { store: 'S', val: 42 },
      wildcardDynamic: true,
    })
    expect(dpNum.toStringPath()).toBe('S.rows[id=42].x')

    const dpStr = DataPath.fromString('$store.rows[id=$val].x', {
      vars: { store: 'S', val: 'LEG_1' },
      wildcardDynamic: true,
    })
    // строки сериализуются в двойных кавычках
    expect(dpStr.toStringPath()).toBe('S.rows[id="LEG_1"].x')
  })

  it('динамика внутри скобок без кавычек (например $expr) → [*] при wildcardDynamic: true', () => {
    const dp = DataPath.fromString('$store.rows[id=$expr].y', {
      vars: { store: 'S' }, // $expr не задан
      wildcardDynamic: true,
    })
    expect(dp.toStringPath()).toBe('S.rows[*].y')
  })
})
