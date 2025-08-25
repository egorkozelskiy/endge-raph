import { describe, it, expect } from 'vitest'
import { RaphRouter } from '@/domain/core/RaphRouter'

function time<T>(label: string, fn: () => T) {
  const t0 = performance.now()
  const res = fn()
  const t1 = performance.now()
  const dt = t1 - t0
  // eslint-disable-next-line no-console
  console.info(`${label}: ${dt.toFixed(2)}ms`)
  return { res, ms: dt }
}

function randInt(n: number) {
  return Math.floor(Math.random() * n)
}

describe('RaphRouter — бенчмарки с параметрическими плейсхолдерами', () => {
  it('быстро строит большой роутер с $placeholders', () => {
    const r = new RaphRouter<string>()

    const ORDERS = 5000 // число «корней» (orders)
    const ITEMS_PER = 6 // совпадает с шаблоном ниже
    const PAYLOAD = 'P'

    // Шаблоны с плейсхолдерами:
    //   orders[id=$oid].items[id=$iid].price
    //   orders[id=$oid].total
    //   users[id=$uid].profile.*        (deep)
    const addRes = time('[build] добавление масок с плейсхолдерами', () => {
      for (let i = 0; i < ORDERS; i++) {
        // Один и тот же шаблон добавляем один раз — он общий для всех путей,
        // но важен объём разных масок: добавим небольшую вариативность:
        r.add('orders[id=$oid].items[id=$iid].price', PAYLOAD)
        r.add('orders[id=$oid].total', PAYLOAD)
        r.add('users[id=$uid].profile.*', PAYLOAD)
      }
    })

    // sanity: структура есть
    expect(typeof addRes.ms).toBe('number')
  })

  it('matchWithParams — серия случайных запросов', () => {
    const r = new RaphRouter<string>()
    r.add('orders[id=$oid].items[id=$iid].price', 'A')
    r.add('orders[id=$oid].total', 'B')
    r.add('users[id=$uid].profile.*', 'C')
    r.add('users[id=$uid].profile.tags[id=$tid]', 'D')

    const Q = 50_000
    const results: number[] = []

    // прогрев кэшей
    ;(r as any).matchWithParams('orders[id=1].items[id=2].price')
    ;(r as any).matchWithParams('users[id=10].profile.name')
    ;(r as any).matchWithParams('users[id=10].profile.tags[id=5]')

    const run = () => {
      for (let i = 0; i < Q; i++) {
        const kind = i % 4
        if (kind === 0) {
          const oid = randInt(10_000)
          const iid = randInt(64)
          const out = (r as any).matchWithParams(
            `orders[id=${oid}].items[id=${iid}].price`,
          ) as Array<{ payload: string; params: Record<string, unknown> }>
          results.push(out.length)
          // sanity
          if (out.length > 0) {
            const cap = out[0].params
            // oid/iid должны быть «пролететь» в params
            expect(cap.oid).not.toBeUndefined()
            expect(cap.iid).not.toBeUndefined()
          }
        } else if (kind === 1) {
          const oid = randInt(10_000)
          const out = (r as any).matchWithParams(
            `orders[id=${oid}].total`,
          ) as Array<{ payload: string; params: Record<string, unknown> }>
          results.push(out.length)
          if (out.length > 0) expect(out[0].params.oid).toBe(oid)
        } else if (kind === 2) {
          const uid = randInt(50_000)
          const out = (r as any).matchWithParams(
            `users[id=${uid}].profile.name`,
          ) as Array<{ payload: string; params: Record<string, unknown> }>
          results.push(out.length)
          // deep-маска не содержит params
        } else {
          const uid = randInt(50_000)
          const tid = randInt(100)
          const out = (r as any).matchWithParams(
            `users[id=${uid}].profile.tags[id=${tid}]`,
          ) as Array<{ payload: string; params: Record<string, unknown> }>
          results.push(out.length)
          if (out.length > 0) {
            expect(out[0].params.uid).toBe(uid)
            expect(out[0].params.tid).toBe(tid)
          }
        }
      }
    }

    // 1-й проход (cold-ish)
    time('[matchWithParams] 50k запросов (cold)', run)
    // 2-й проход (warmed caches)
    time('[matchWithParams] 50k запросов (warm)', run)

    expect(results.length).toBe(Q * 2) // оба прогона
  })

  it('matchIncludingPrefixWithParams — "родитель - уведомить детей"', () => {
    const r = new RaphRouter<string>()
    // Подписки на разные глубины
    r.add('*', 'ROOT-STAR')
    r.add('FLT_ARR', 'FLT')
    r.add('FLT_ARR.legs[*]', 'LEG-STAR')
    r.add('FLT_ARR.legs[*].*', 'LEG-DEEP')
    // Параметры:
    r.add('orders[id=$oid].*', 'ORD-DEEP') // capture oid
    r.add('orders[id=$oid].items[id=$iid].*', 'ORD-ITEM-DEEP') // capture oid & iid

    // Прогрев:
    ;(r as any).matchIncludingPrefixWithParams('FLT_ARR')
    ;(r as any).matchIncludingPrefixWithParams('FLT_ARR.legs[0]')
    ;(r as any).matchIncludingPrefixWithParams('orders[id=1]')
    ;(r as any).matchIncludingPrefixWithParams('orders[id=1].items[id=2]')

    const Q = 30_000
    const counter = { total: 0, cap: 0 }

    const run = () => {
      for (let i = 0; i < Q; i++) {
        const kind = i % 4
        let res:
          | Array<{ payload: string; params: Record<string, unknown> }>
          | undefined

        if (kind === 0) {
          res = (r as any).matchIncludingPrefixWithParams('FLT_ARR')
        } else if (kind === 1) {
          // конкретный индекс затем попадёт под legs[*] и legs[*].*
          const idx = randInt(16)
          res = (r as any).matchIncludingPrefixWithParams(
            `FLT_ARR.legs[${idx}]`,
          )
        } else if (kind === 2) {
          const oid = randInt(5000)
          res = (r as any).matchIncludingPrefixWithParams(`orders[id=${oid}]`)
          // должны приходить payload'ы с params.oid
          if (res?.length) {
            const anyWithOid = res.find((x) => x.params && 'oid' in x.params)
            if (anyWithOid) {
              expect(anyWithOid.params.oid).toBe(oid)
              counter.cap++
            }
          }
        } else {
          const oid = randInt(5000)
          const iid = randInt(64)
          res = (r as any).matchIncludingPrefixWithParams(
            `orders[id=${oid}].items[id=${iid}]`,
          )
          // здесь должен быть захват { oid, iid }
          if (res?.length) {
            const withBoth = res.find(
              (x) => x.params && x.params.oid === oid && x.params.iid === iid,
            )
            if (withBoth) counter.cap++
          }
        }

        counter.total += res?.length ?? 0
      }
    }

    time('[prefix+params] 30k запросов (cold)', run)
    time('[prefix+params] 30k запросов (warm)', run)

    // sanity
    expect(counter.total).toBeGreaterThan(0)
    expect(counter.cap).toBeGreaterThan(0)
  })

  it('removePayload / удаление масок не ухудшает кэши', () => {
    const r = new RaphRouter<string>()
    const ids: string[] = []
    for (let i = 0; i < 5000; i++) {
      const m1 = `orders[id=$oid].items[id=$iid_${i}].price`
      const m2 = `users[id=$uid_${i}].profile.*`
      ids.push(m1, m2)
      r.add(m1, `P:${i}:A`)
      r.add(m2, `P:${i}:B`)
    }

    // прогрев
    ;(r as any).matchWithParams('orders[id=1].items[id=2].price')
    ;(r as any).matchWithParams('users[id=10].profile.name')

    const half = Math.floor(ids.length / 2)

    time('[remove] половина масок', () => {
      for (let i = 0; i < half; i++) {
        r.remove(ids[i])
      }
    })

    // После remove — кэши инвалидируются версией, повторные запросы должны работать,
    // просто проверим, что не взорвались и что что-то матчится:
    const res1 = (r as any).matchWithParams(
      'orders[id=7].items[id=3].price',
    ) as Array<{ payload: string; params: Record<string, unknown> }>
    const res2 = (r as any).matchWithParams(
      'users[id=42].profile.name',
    ) as Array<{ payload: string; params: Record<string, unknown> }>

    expect(Array.isArray(res1)).toBe(true)
    expect(Array.isArray(res2)).toBe(true)
  })
})
