import { describe, it, expect } from 'vitest'
import { DataPath } from '@/domain/entities/DataPath'

function ok(mask: string, target: string): void {
  expect(DataPath.match(mask, target)).toBe(true)
}
function no(mask: string, target: string): void {
  expect(DataPath.match(mask, target)).toBe(false)
}

describe('DataPath.match', () => {
  it('точные ключи (без wildcard)', () => {
    ok('com.x', 'com.x')
    no('com.x', 'com.y')
    no('com.x', 'com')
    no('com', 'com.x')
  })

  it('одиночный wildcard в середине совпадает ровно с одним сегментом', () => {
    ok('a.*.c', 'a.b.c')
    ok('a.*.c', 'a.zzz.c')
    no('a.*.c', 'a.b.d.c') // больше одного сегмента на месте '*'
    no('a.*.c', 'a.c') // нулевой сегмент на месте '*'
  })

  it('глубокий wildcard в конце (хвостовой *) совпадает с любым суффиксом (включая пустой)', () => {
    ok('com.*', 'com')
    ok('com.*', 'com.x')
    ok('com.*', 'com.x.y')
    ok('root.level.*', 'root.level') // пустой хвост тоже ок
    ok('root.level.*', 'root.level.a.b') // любой глубины
  })

  it('индекс массива и wildcard любого элемента', () => {
    ok('rows[0].name', 'rows[0].name')
    no('rows[0].name', 'rows[1].name')
    ok('rows[*].name', 'rows[0].name')
    ok('rows[*].name', 'rows[10].name')
    no('rows[*].name', 'rows.name') // отсутствует индекс / не param/index
  })

  it('один параметр на сегмент', () => {
    ok('com[id=10].x', 'com[id=10].x')
    no('com[id=10].x', 'com[id=9].x')
    no('com[id=10].x', 'com[id=10].y')
    no('com[id=10].x', 'com.x') // нет параметра в сегменте цели
  })

  it('параметры с числами и строками в кавычках', () => {
    ok('n[id=42].m', 'n[id=42].m')
    ok('n[name="foo"].v', 'n[name="foo"].v')
    no('n[id=42].m', 'n[id="42"].m') // числа vs строки — различные значения
    ok('n[name="foo"].v', 'n[name=foo].v') // без кавычек -> другое значение
  })

  it('смешанные шаблоны (key + [*] + одиночный-* + глубокий-*)', () => {
    ok('root.level.*.leaf[*].*', 'root.level.A.leaf[id=10].x.y')
    ok('root.level.*.leaf[*].*', 'root.level.B.leaf[gid=1]')
    no('root.level.*.leaf[*].*', 'root.layer.A.leaf[id=1].x') // другой prefix key
    no('root.level.*.leaf[*].*', 'root.level.A.B.leaf[id=1].x') // два сегмента на месте одиночного '*'
  })

  it('префикс vs полный путь (без глубокого-*)', () => {
    no('a.b', 'a.b.c')
    no('a.b.c', 'a.b')
  })

  it('звезда как первый/единственный сегмент', () => {
    ok('*', 'x')
    ok('*', 'x.y')
    ok('*', '')
  })
})
