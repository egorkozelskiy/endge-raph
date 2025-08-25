import { describe, it, expect, beforeEach } from 'vitest'
import { RaphRouter } from '@/domain/core/RaphRouter'

describe('RaphRouter.matchWithParams', () => {
  let r: RaphRouter<string>

  beforeEach(() => {
    r = new RaphRouter<string>()
  })

  it('captures params for [id=$var] placeholders', () => {
    const r = new RaphRouter<string>()

    // Маска с плейсхолдерами: [id=$oid], [id=$iid]
    r.add('orders[id=$oid].items[id=$iid].price', 'PAYLOAD')

    const res = (r as any).matchWithParams('orders[id=42].items[id=7].price')
    expect(Array.isArray(res)).toBe(true)
    expect(res.length).toBe(1)
    expect(res[0].payload).toBe('PAYLOAD')
    expect(res[0].params).toEqual({ oid: 42, iid: 7 })
  })

  it('coexists with deep wildcard masks', () => {
    const r = new RaphRouter<string>()
    r.add('root.*', 'DEEP')
    r.add('root.a[id=$x].b', 'CAP')

    // Совпадает обе маски
    const res = (r as any).matchWithParams('root.a[id=10].b')
    // Порядок не гарантируем; проверим множеством
    const tags = new Set(res.map((x: any) => x.payload))
    expect(tags.has('DEEP')).toBe(true)
    expect(tags.has('CAP')).toBe(true)

    const cap = res.find((x: any) => x.payload === 'CAP')!
    expect(cap.params).toEqual({ x: 10 })

    // deep-маска не несёт params
    const deep = res.find((x: any) => x.payload === 'DEEP')!
    expect(deep.params).toEqual({})
  })

  it('exact param match still works (no captures)', () => {
    const r = new RaphRouter<string>()
    r.add('users[id=7].name', 'U7N')

    const res = (r as any).matchWithParams('users[id=7].name')
    expect(res.length).toBe(1)
    expect(res[0]).toEqual({ payload: 'U7N', params: {} })
  })

  it('должен находить точный матч без параметров', () => {
    r.add('a.b.c', 'X')
    const res = r.matchIncludingPrefixWithParams('a.b.c')
    expect(res).toEqual([{ payload: 'X', params: {} }])
  })

  it('должен находить deep-подписку', () => {
    r.add('a.b.*', 'Y')
    const res = r.matchIncludingPrefixWithParams('a.b.c')
    expect(res).toEqual([{ payload: 'Y', params: {} }])
  })

  it('должен обрабатывать параметризованный путь', () => {
    r.add('user[$id].profile', 'P')
    const res = r.matchIncludingPrefixWithParams('user[123].profile')
    expect(res).toEqual([{ payload: 'P', params: { id: 123 } }])
  })

  it('должен включать все "ниже" префикса', () => {
    r.add('user[$id].profile.details', 'D')
    r.add('user[$id].profile', 'P')

    const res = r.matchIncludingPrefixWithParams('user[42].profile')

    expect(res).toContainEqual({ payload: 'P', params: { id: 42 } })
    expect(res).toContainEqual({ payload: 'D', params: { id: 42 } })
  })

  it('не должен дублировать payload при одновременном exact и prefix', () => {
    r.add('a.b', 'X')
    r.add('a.b.c', 'Y')

    const res = r.matchIncludingPrefixWithParams('a.b')
    expect(res).toEqual([
      { payload: 'X', params: {} },
      { payload: 'Y', params: {} },
    ])
  })

  it('должен захватывать несколько параметров', () => {
    r.add('order[$oid].item[$iid]', 'O')
    const res = r.matchIncludingPrefixWithParams('order[111].item[222]')
    expect(res).toEqual([{ payload: 'O', params: { oid: 111, iid: 222 } }])
  })
})
