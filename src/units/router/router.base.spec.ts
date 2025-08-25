import { describe, it, expect, beforeEach } from 'vitest'
import { RaphRouter } from '@/domain/core/RaphRouter'

describe('Router', () => {
  let router: RaphRouter

  beforeEach(() => {
    router = new RaphRouter()
  })

  function expectSetEqual<T>(set: Set<T>, arr: T[]): void {
    expect(set.size).toBe(arr.length)
    for (const v of arr) expect(set.has(v)).toBe(true)
  }

  // Точные ключи без wildcard
  it('matches exact keys', () => {
    router.add('com.x', 'H1')
    router.add('com.y', 'H2')
    router.add('data.a.b', 'H3')

    expectSetEqual(router.match('com.x'), ['H1'])
    expectSetEqual(router.match('com.y'), ['H2'])
    expectSetEqual(router.match('data.a.b'), ['H3'])
    expectSetEqual(router.match('com.z'), [])
    expectSetEqual(router.match('data.a'), [])
  })

  // Обычный сегментный wildcard "*"
  // "*" в середине — матчит ровно 1 сегмент
  it('matches single-segment wildcard "*" in the middle', () => {
    router.add('com.*', 'W1')
    router.add('a.*.c', 'W2')

    expectSetEqual(router.match('com.x'), ['W1'])
    expectSetEqual(router.match('com.y'), ['W1'])
    expectSetEqual(router.match('a.b.c'), ['W2'])
    expectSetEqual(router.match('a.z.c'), ['W2'])

    // не матчит другой префикс
    expectSetEqual(router.match('data.x'), [])

    // не матчит >1 сегмента
    expectSetEqual(router.match('a.b.d.c'), [])
  })

  // Параметры в сегменте: [id=7], [id="x"], [id=*]
  // "*" в значении параметра — любое значение этого параметра
  it('matches parameterized segments with exact or wildcard values', () => {
    // обе добавлены под одним и тем же namespace
    router.add('com[id=7].x', 'P1')
    router.add('com[*].x', 'PAny')

    // ровно id=7 - P1 + PAny
    expectSetEqual(router.match('com[id=7].x'), ['P1', 'PAny'])

    // другой id - только PAny
    expectSetEqual(router.match('com[id=8].x'), ['PAny'])

    // другой ключ, но параметризованный сегмент сохранился
    expectSetEqual(router.match('com[id=7].y'), [])
  })

  // Несколько парамет ров, числа/строки, смешанные кавычки
  it('matches multiple params and quoted/unquoted values', () => {
    router.add('items[*][type="task"][gid=5].v', 'MP')

    expectSetEqual(router.match('items[id=1][type="task"][gid=5].v'), ['MP'])
    expectSetEqual(router.match('items[foo="bar"][type="task"][gid=5].v'), [
      'MP',
    ])

    // несовпадение по одному из параметров
    expectSetEqual(router.match('items[id=1][type="group"][gid=5].v'), [])
    expectSetEqual(router.match('items[id=1][type="task"][gid=7].v'), [])
  })

  // Микс: точные + wildcard + greedy + параметры
  it('matches combined patterns (mix of fixed, "*", "**" and params)', () => {
    router.add('root.level.*.leaf[*].*', 'C1')

    // 1) ровно один произвольный сегмент на месте "*"
    // 2) параметризованный leaf с любым id
    // 3) хвостовая глубина — любая
    expectSetEqual(router.match('root.level.A.leaf[id=10].x.y'), ['C1'])
    expectSetEqual(router.match('root.level.B.leaf[id="abc"]'), ['C1'])

    // не пройдёт, если "*"-место — много сегментов
    expectSetEqual(router.match('root.level.A.B.leaf[id=1].x'), [])
    // не пройдёт, если другая структура
    expectSetEqual(router.match('root.layer.A.leaf[id=1].x'), [])
  })

  // Множественные обработчики на один маршрут
  it('allows multiple handlers per the same pattern', () => {
    router.add('com.x', 'H1')
    router.add('com.x', 'H2')
    router.add('com.x', 'H1') // дубликат — не должен дублироваться в выдаче

    expectSetEqual(router.match('com.x'), ['H1', 'H2'])
  })

  // Удаление обработчиков/маршрутов
  it('removes handlers/routes correctly', () => {
    router.add('com.x', 'H1')
    router.add('com.x', 'H2')
    router.add('com.*', 'W1')

    // удаление одного обработчика по ключу
    router.remove('com.x', 'H1')
    expectSetEqual(router.match('com.x'), ['H2', 'W1'])

    // удаление последнего обработчика по ключу — должен исчезнуть весь лист
    router.remove('com.x', 'H2')
    expectSetEqual(router.match('com.x'), ['W1'])

    // удаление wildcard-обработчика
    router.remove('com.*', 'W1')
    expectSetEqual(router.match('com.x'), [])
  })

  // Индексация по префиксу: независимые namespace-ветки
  it('keeps independent namespaces under distinct prefixes', () => {
    router.add('com.*', 'C')
    router.add('data.*', 'D')

    expectSetEqual(router.match('com'), ['C'])
    expectSetEqual(router.match('com.a.b'), ['C'])
    expectSetEqual(router.match('data'), ['D'])
    expectSetEqual(router.match('data.x'), ['D'])
    expectSetEqual(router.match('cfg'), [])
  })

  // Кэш-хит: повторные запросы того же пути
  // (невозможно проверить микротаймингом — просто функционально)
  it('returns identical results on repeated queries (cache hit scenario)', () => {
    router.add('com.*', 'W')
    router.add('com.x', 'H')
    const r1 = router.match('com.x')
    const r2 = router.match('com.x')
    expectSetEqual(r1, ['W', 'H'])
    expectSetEqual(r2, ['W', 'H'])
  })

  // Параметры с кавычками и числами: совместимость парсера
  it('parses and matches params with quotes and numbers correctly', () => {
    router.add('n[id="42"].m', 'Q1')
    router.add('n[id=42].m', 'Q2')
    router.add('n[*].m', 'QAny')

    const res = router.match('n[id=42].m')
    expect(res.has('QAny')).toBe(true)
    expect(res.size >= 1).toBe(true)
  })

  // Сложный кейс: пересечение разных шаблонов
  it('returns union of all matching handlers across overlapping patterns', () => {
    router.add('a.b.c', 'Exact')
    router.add('a.*.c', 'MidStar')
    router.add('a.*', 'Greedy')
    router.add('a.b[*].c', 'ParamStar') // не сработает для "a.b.c" (нет params), но пускай висит
    router.add('a.b.c[id=1]', 'LeafParam') // другой формат — не совпадёт, если парсер считает [id=?] как отдельный узел

    const res = router.match('a.b.c')
    // Должны попасть: Exact, MidStar, Greedy
    expect(res.has('Exact')).toBe(true)
    expect(res.has('MidStar')).toBe(true)
    expect(res.has('Greedy')).toBe(true)
    // Эти — нет
    expect(res.has('ParamStar')).toBe(false)
    expect(res.has('LeafParam')).toBe(false)
  })

  // Индекс/массивный сегмент: rows[0].name / rows[*].name
  it('matches array-like addressing: rows[0].name and rows[*].name', () => {
    router.add('rows[0].name', 'R0')
    router.add('rows[*].name', 'Rstar')

    expectSetEqual(router.match('rows[0].name'), ['R0', 'Rstar'])
    expectSetEqual(router.match('rows[1].name'), ['Rstar'])
    expectSetEqual(router.match('rows.name'), [])
  })

  // Маршруты с несколькими сегментами и суффиксным wildcard работают корректно
  it('matches single-segment wildcard "*" in the middle', () => {
    router.add('scene.layers.*', 'W1')
    router.add('scene.*', 'W2')

    expectSetEqual(router.match('scene.layers[id="a"].*'), ['W1', 'W2'])
    expectSetEqual(router.match('scene.meta.title'), ['W2'])
  })
})
