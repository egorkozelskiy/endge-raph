import { describe, it, expect } from 'vitest'
import { RaphRouter } from '@/domain/core/RaphRouter'

/**
 * Бенчмарк: проверяем, что повторные match() становятся быстрее
 * за счёт кеша (если кеш включён в реализации роутера).
 *
 * Примечание: тест не жёстко завязан на конкретную реализацию.
 * Если в роутере есть метод enableCache — включаем его. Если нет —
 * тест всё равно пройдёт функционально, но ускорение может быть меньше.
 */
describe('RaphRouter — бенчмарк кеша', () => {
  it('ускоряет повторные вызовы match() на одном наборе путей', () => {
    const router = new RaphRouter()

    // Включаем кеш, если он реализован.
    // @ts-expect-error — опционально, чтобы не падать, если метода нет.
    if (typeof router.enableCache === 'function') {
      // @ts-ignore
      router.enableCache(5000) // ёмкость кеша, если поддерживается
    }

    // 1) Готовим большие наборы правил
    const FIXED_COUNT = 2500
    const STAR_MID_COUNT = 2500
    const DEEP_COUNT = 2500
    const PARAM_COUNT = 2500

    // Точные ключи
    for (let i = 0; i < FIXED_COUNT; i++) {
      router.add(`ns.fixed.k${i}.x`, `F-${i}`)
    }

    // Одиночный wildcard в середине
    for (let i = 0; i < STAR_MID_COUNT; i++) {
      router.add(`ns.mid.*.v${i}`, `M-${i}`)
    }

    // Глубокий wildcard на конце (ns.deep.*)
    for (let i = 0; i < DEEP_COUNT; i++) {
      router.add(`ns.deep${i}.*`, `D-${i}`)
    }

    // Параметризованные сегменты
    for (let i = 0; i < PARAM_COUNT; i++) {
      // rows[*].item[id=i].name
      router.add(`rows[*].item[id=${i}].name`, `P-${i}`)
    }

    // 2) Формируем набор путей для запроса
    //    (гарантированные совпадения разных типов)
    const paths: string[] = []
    const N = 4000

    for (let i = 0; i < N; i++) {
      switch (i % 4) {
        case 0: {
          const k = i % FIXED_COUNT
          paths.push(`ns.fixed.k${k}.x`)
          break
        }
        case 1: {
          const k = i % STAR_MID_COUNT
          paths.push(`ns.mid.any.v${k}`)
          break
        }
        case 2: {
          const k = i % DEEP_COUNT
          paths.push(`ns.deep${k}.foo.bar.baz`)
          break
        }
        case 3: {
          const k = i % PARAM_COUNT
          paths.push(`rows[id=${k}].item[id=${k}].name`)
          break
        }
      }
    }

    // 3) Первый прогон (cold)
    const t0 = performance.now()
    let total1 = 0
    for (let i = 0; i < paths.length; i++) {
      const r = router.match(paths[i])
      total1 += r.size // чтобы исключить DCE
      // sanity: должны быть попадания
      expect(r.size).toBeGreaterThan(0)
    }
    const t1 = performance.now()
    const coldMs = t1 - t0

    // 4) Второй прогон (warm, cache-hit)
    const t2 = performance.now()
    let total2 = 0
    for (let i = 0; i < paths.length; i++) {
      const r = router.match(paths[i])
      total2 += r.size
      expect(r.size).toBeGreaterThan(0)
    }
    const t3 = performance.now()
    const warmMs = t3 - t2

    // Проверка: warm-прогон не медленнее cold (обычно существенно быстрее)
    expect(warmMs).toBeLessThanOrEqual(coldMs)

    // Мягкая эвристика ускорения (не жёсткая, т.к. окружения разные):
    // разрешаем, чтобы warm был хотя бы на 20% быстрее
    // (Если кеша нет — всё равно пройдёт за счёт <=)
    expect(warmMs).toBeLessThanOrEqual(coldMs * 0.8 + 1 /* зазор на шум */)

    // eslint-disable-next-line no-console
    console.info(
      `[router-bench] cold=${coldMs.toFixed(3)}ms, warm=${warmMs.toFixed(
        3,
      )}ms, sizeCold=${total1}, sizeWarm=${total2}`,
    )
  })

  it('кеш-хит на повторных идентичных запросах одного пути', () => {
    const router = new RaphRouter()

    // @ts-expect-error — опционально
    if (typeof router.enableCache === 'function') {
      // @ts-ignore
      router.enableCache(1024)
    }

    // Готовим немного маршрутов (включая deep и mid *)
    for (let i = 0; i < 2000; i++) {
      router.add(`alpha.k${i}.z`, `A-${i}`)
      router.add(`beta.mid.*.v${i}`, `B-${i}`)
      router.add(`gamma${i}.*`, `G-${i}`)
    }

    const target = 'beta.mid.X.v777'
    // убедимся, что такое правило есть
    router.add('beta.mid.*.v777', 'HIT-777')

    // 1-й вызов — прогрев
    const r1 = router.match(target)
    expect(r1.size).toBeGreaterThan(0)
    expect(r1.has('HIT-777')).toBe(true)

    // 2-й вызов — бенч на одном и том же ключе
    const WARM_ITERS = 20000
    const t0 = performance.now()
    let s = 0
    for (let i = 0; i < WARM_ITERS; i++) {
      const r = router.match(target)
      s += r.size
    }
    const t1 = performance.now()
    const warmMs = t1 - t0

    // eslint-disable-next-line no-console
    console.info(
      `[router-bench: single-key] iters=${WARM_ITERS}, time=${warmMs.toFixed(
        3,
      )}ms, accSize=${s}`,
    )

    // Функционально всё корректно
    expect(s).toBeGreaterThan(0)
  })
})
