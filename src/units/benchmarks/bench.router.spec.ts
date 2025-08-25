import { describe, it, beforeEach } from 'vitest'
import { RaphRouter } from '@/domain/core/RaphRouter'

/**
 * Бенчмарки для RaphRouter
 *
 * ПРИМЕЧАНИЕ:
 * - Нет жёстких проверок времени; мы просто логируем числа для сравнения между запусками/ветками.
 * - Области фокуса:
 *    1) производительность add() (точные, wildcard, параметры)
 *    2) производительность match() на холодном и тёплом кэше
 *    3) смешанные типы шаблонов (точные / mid-star / tail-greedy / параметры / индексы массива)
 */

const KB = 1024

// Простой детерминированный псевдо‑рандом для воспроизводимости
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function now() {
  return (typeof performance !== 'undefined' ? performance : Date).now()
}

function fmt(num: number, digits = 3) {
  return Number.isFinite(num) ? num.toFixed(digits) : String(num)
}

function logBench(title: string, data: Record<string, number | string>) {
  const parts = Object.entries(data).map(([k, v]) => `${k}=${v}`)
  // eslint-disable-next-line no-console
  console.info(`[bench][${title}] ${parts.join(', ')}`)
}

describe('RaphRouter – бенчмарки', () => {
  let router: RaphRouter

  beforeEach(() => {
    router = new RaphRouter()
  })

  it('add() производительность: точные ключи (N=50k)', () => {
    const N = 50_000
    const patterns: string[] = []
    for (let i = 0; i < N; i++) patterns.push(`com.k${i}.v`)

    const t0 = now()
    for (let i = 0; i < N; i++) {
      router.add(patterns[i], 'E')
    }
    const t1 = now()

    logBench('add:точные', {
      N,
      totalMs: fmt(t1 - t0),
      perOpUs: fmt(((t1 - t0) * 1000) / N),
      routes: router.size,
    })
  })

  it('add() производительность: mid‑wildcard (N=20k) и tail‑greedy (N=20k)', () => {
    const N = 20_000
    const t0 = now()
    for (let i = 0; i < N; i++) router.add(`a.${i % 50}.*.c`, 'W')
    const t1 = now()
    for (let i = 0; i < N; i++) router.add(`topic${i % 100}.*`, 'G')
    const t2 = now()

    logBench('add:wildcards', {
      midN: N,
      midTotalMs: fmt(t1 - t0),
      tailN: N,
      tailTotalMs: fmt(t2 - t1),
      routes: router.size,
    })
  })

  it('add() производительность: параметры (N=20k)', () => {
    const N = 20_000
    const t0 = now()
    for (let i = 0; i < N; i++) {
      router.add(`rows[*][type="t${i % 7}"][gid=${i % 97}].name`, 'P')
    }
    const t1 = now()
    logBench('add:параметры', {
      N,
      totalMs: fmt(t1 - t0),
      perOpUs: fmt(((t1 - t0) * 1000) / N),
      routes: router.size,
    })
  })

  it('match() производительность: точные совпадения (N=200k) – холодный и тёплый кэш', () => {
    // Подготовка маршрутов с точными путями
    const N = 100_000
    for (let i = 0; i < N; i++) router.add(`com.k${i}.v`, 'E')

    const Q = 200_000
    const t0 = now()
    for (let i = 0; i < Q; i++) {
      router.match(`com.k${i % N}.v`)
    }
    const t1 = now()

    // Повтор на тёплом кэше
    for (let i = 0; i < Q; i++) {
      router.match(`com.k${i % N}.v`)
    }
    const t2 = now()

    logBench('match:точные', {
      routes: router.size,
      Q,
      coldMs: fmt(t1 - t0),
      coldPerOpUs: fmt(((t1 - t0) * 1000) / Q),
      warmMs: fmt(t2 - t1),
      warmPerOpUs: fmt(((t2 - t1) * 1000) / Q),
    })
  })

  it('match() производительность: mid‑wildcard (N=150k) – холодный и тёплый кэш', () => {
    // Подготовка wildcard вида a.X.*.c
    router = new RaphRouter()
    const N = 150_000
    for (let i = 0; i < N; i++) {
      router.add(`a.${i % 211}.*.c`, 'W')
    }
    const Q = 200_000

    const t0 = now()
    for (let i = 0; i < Q; i++) {
      router.match(`a.${i % 211}.b.c`)
    }
    const t1 = now()

    for (let i = 0; i < Q; i++) {
      router.match(`a.${i % 211}.b.c`)
    }
    const t2 = now()

    logBench('match:mid-wildcard', {
      routes: router.size,
      Q,
      coldMs: fmt(t1 - t0),
      coldPerOpUs: fmt(((t1 - t0) * 1000) / Q),
      warmMs: fmt(t2 - t1),
      warmPerOpUs: fmt(((t2 - t1) * 1000) / Q),
    })
  })

  it('match() производительность: tail‑greedy (N=100k) – холодный и тёплый кэш', () => {
    router = new RaphRouter()
    const N = 100_000
    for (let i = 0; i < N; i++) router.add(`topic${i % 257}.*`, 'G')

    const Q = 200_000
    const t0 = now()
    for (let i = 0; i < Q; i++) {
      // совпадения любой глубины
      router.match(`topic${i % 257}.foo.bar.baz`)
    }
    const t1 = now()

    for (let i = 0; i < Q; i++) {
      router.match(`topic${i % 257}.foo.bar.baz`)
    }
    const t2 = now()

    logBench('match:tail-greedy', {
      routes: router.size,
      Q,
      coldMs: fmt(t1 - t0),
      coldPerOpUs: fmt(((t1 - t0) * 1000) / Q),
      warmMs: fmt(t2 - t1),
      warmPerOpUs: fmt(((t2 - t1) * 1000) / Q),
    })
  })

  it('match() производительность: параметры (N=80k) – смешанные запросы (холодный и тёплый)', () => {
    router = new RaphRouter()
    const N = 80_000
    for (let i = 0; i < N; i++) {
      // rows[*] означает "любой элемент", плюс другие параметры сужают совпадение
      router.add(`rows[*][type="t${i % 11}"][gid=${i % 131}].name`, 'P')
    }

    const Q = 200_000
    const rnd = mulberry32(123)

    const makeQuery = (i: number) => {
      // 70% совпадений, 30% несовпадений
      if (rnd() < 0.7) {
        const type = `t${i % 11}`
        const gid = i % 131
        // целевой путь имеет конкретный id - должен совпасть с rows[*]
        return `rows[id=${i % 499}][type="${type}"][gid=${gid}].name`
      } else {
        return `rows[id=${i % 499}][type="x${i % 11}"][gid=${(i + 3) % 131}].name`
      }
    }

    const queries = new Array(Q)
    for (let i = 0; i < Q; i++) queries[i] = makeQuery(i)

    const t0 = now()
    for (let i = 0; i < Q; i++) router.match(queries[i])
    const t1 = now()

    for (let i = 0; i < Q; i++) router.match(queries[i])
    const t2 = now()

    logBench('match:параметры', {
      routes: router.size,
      Q,
      coldMs: fmt(t1 - t0),
      coldPerOpUs: fmt(((t1 - t0) * 1000) / Q),
      warmMs: fmt(t2 - t1),
      warmPerOpUs: fmt(((t2 - t1) * 1000) / Q),
    })
  })

  it('смешанная нагрузка: add + match с изменением (routes=30k, queries=200k)', () => {
    router = new RaphRouter()
    const addN = 30_000
    const rnd = mulberry32(42)

    // Смешанные: точные / wildcard / параметры / массивы
    const tAdd0 = now()
    for (let i = 0; i < addN; i++) {
      const r = rnd()
      if (r < 0.25) {
        router.add(`com.k${i}.v`, 'E')
      } else if (r < 0.5) {
        router.add(`a.${i % 97}.*.c`, 'W')
      } else if (r < 0.75) {
        router.add(`topic${i % 151}.*`, 'G')
      } else {
        router.add(`rows[*][gid=${i % 89}].name`, 'P')
      }
    }
    const tAdd1 = now()

    const Q = 200_000
    const queries: string[] = []
    for (let i = 0; i < Q; i++) {
      const r = rnd()
      if (r < 0.25) queries.push(`com.k${i % addN}.v`)
      else if (r < 0.5) queries.push(`a.${i % 97}.x.c`)
      else if (r < 0.75) queries.push(`topic${i % 151}.foo.bar`)
      else queries.push(`rows[id=${i % 200}][gid=${i % 89}].name`)
    }

    // Холодный
    const tMatch0 = now()
    for (let i = 0; i < Q; i++) router.match(queries[i])
    const tMatch1 = now()

    // Тёплый
    for (let i = 0; i < Q; i++) router.match(queries[i])
    const tMatch2 = now()

    // Удаление ~10% маршрутов, затем повторный match
    const toRemove = Math.floor(addN * 0.1)
    const tRem0 = now()
    for (let i = 0; i < toRemove; i++) {
      // Удаление по возможности (только некоторые будут существовать точно; зависит от добавленного)
      router.remove(`com.k${i}.v`, 'E')
      router.remove(`a.${i % 97}.*.c`, 'W')
      router.remove(`topic${i % 151}.*`, 'G')
      router.remove(`rows[*][gid=${i % 89}].name`, 'P')
    }
    const tRem1 = now()

    for (let i = 0; i < Q; i++) router.match(queries[i])
    const tMatch3 = now()

    logBench('смешанная', {
      addN: addN,
      addMs: fmt(tAdd1 - tAdd0),
      matchColdMs: fmt(tMatch1 - tMatch0),
      matchColdPerOpUs: fmt(((tMatch1 - tMatch0) * 1000) / Q),
      matchWarmMs: fmt(tMatch2 - tMatch1),
      matchWarmPerOpUs: fmt(((tMatch2 - tMatch1) * 1000) / Q),
      removed: toRemove,
      removeMs: fmt(tRem1 - tRem0),
      matchAfterRemoveMs: fmt(tMatch3 - tRem1),
      matchAfterRemovePerOpUs: fmt(((tMatch3 - tRem1) * 1000) / Q),
      routesNow: router.size,
    })
  })

  it('память: добавление 100k маршрутов, измерение памяти процесса (только node)', () => {
    // Это очень грубый индикатор и полезен только в Node (JSDOM/Browser env игнорирует это)
    router = new RaphRouter()
    const N = 100_000
    for (let i = 0; i < N; i++) {
      if ((i & 3) === 0) router.add(`a.${i % 97}.*.c`, 'W')
      else if ((i & 3) === 1) router.add(`topic${i % 151}.*`, 'G')
      else if ((i & 3) === 2) router.add(`rows[*][gid=${i % 89}].name`, 'P')
      else router.add(`com.k${i}.v`, 'E')
    }

    // @ts-expect-error: process может быть undefined в browser-like env
    const mem =
      typeof process !== 'undefined' && process.memoryUsage
        ? process.memoryUsage()
        : null
    const rssMb = mem ? (mem.rss / KB / KB).toFixed(1) : 'n/a'
    const heapMb = mem ? (mem.heapUsed / KB / KB).toFixed(1) : 'n/a'

    logBench('память', {
      routes: router.size,
      rssMB: rssMb,
      heapUsedMB: heapMb,
    })
  })
})
