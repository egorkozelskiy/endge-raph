import type { DataPathSegment, ParamValue } from '@/domain/types/path.types'
import { SegKind } from '@/domain/types/path.types'

/**
 * Лёгкая модель пути с парсером строкового формата:
 *  - Дот-сегменты: com.x.y
 *  - Индексы/параметры в []: [5], [*], [id=10], [name="foo"]
 *
 * Правила:
 *  - '*' в середине пути - wildcard ровно одного сегмента (dot wildcard)
 *  - '*' последним сегментом без параметров - глубокий wildcard (совпадает с любой остаточной глубиной, включая пустую)
 *  - Индекс массива: [5]
 *  - Параметризованный выбор элемента массива: [id=10]
 *  - Подписка на все элементы массива: [*] (index wildcard)
 *  - id=* (значение-параметр wildcard) — не поддерживаем
 */
export class DataPath {
  private readonly _segs: DataPathSegment[]

  // Глобальные кэши
  static _cacheFromString = new Map<string, DataPath>()
  static _cacheToString = new WeakMap<DataPath, string>()
  static _cacheSegments = new Map<string, DataPathSegment[]>()

  private constructor(segs: DataPathSegment[]) {
    this._segs = segs

    // deepWildcard помечаем только для ключевого '*' (dot wildcard) на хвосте, не для '[*]'
    if (this._segs.length > 0) {
      const last = this._segs[this._segs.length - 1] as any
      if (last.kind === SegKind.Wildcard && !last.asIndex) {
        last.deepWildcard = true
      }
    }
  }

  static from(
    input: string | DataPath | Record<string, any>,
    opts?: { vars?: Record<string, unknown>; wildcardDynamic?: boolean },
  ): DataPath {
    if (input instanceof DataPath) return input
    if (typeof input === 'string') return DataPath.fromString(input, opts)
    return DataPath.fromPlain(input)
  }

  /**
   * Быстрый разбор строки пути.
   * Допускаются:
   *   - foo.bar
   *   - foo[*].bar
   *   - foo[id=10].bar
   *   - foo[3].bar
   *   - foo.*.bar
   *   - foo.*   (глубокий wildcard)
   */
  static fromString(
    path: string,
    opts?: { vars?: Record<string, unknown>; wildcardDynamic?: boolean },
  ): DataPath {
    if (!path) return new DataPath([])

    const WILDCARD = Boolean(opts?.wildcardDynamic)

    // Интерполяция $vars; если wildcardDynamic=true, неизвестные переменные заменяются на wildcard
    path = opts?.vars ? DataPath._interpolate(path, opts.vars, WILDCARD) : path

    // Кэш готового DataPath
    const cached = DataPath._cacheFromString.get(path)
    if (cached) return cached

    // Кэш сегментов
    const segsFromCache = DataPath._cacheSegments.get(path)
    const segs = segsFromCache ?? DataPath._parseSegments(path)

    if (!segsFromCache) DataPath._cacheSegments.set(path, segs)

    const dp = new DataPath(segs)
    DataPath._cacheFromString.set(path, dp)
    return dp
  }

  /**
   * Интерполяция $vars в ключах, индексах и значениях параметров.
   * Если wildcardDynamic=true — неизвестные переменные превращаются в wildcard:
   *   - [$var] -> [*]
   *   - [key=$var] -> [*]
   *   - $key -> *
   */
  private static _interpolate(
    src: string,
    vars: Record<string, unknown>,
    wildcardDynamic: boolean,
  ): string {
    const has = (name: string) =>
      Object.prototype.hasOwnProperty.call(vars, name)
    const get = (name: string) => (has(name) ? vars[name] : undefined)

    let s = src

    // [key=$var]
    s = s.replace(
      /\[([a-zA-Z_$][\w$]*)\s*=\s*(\$[a-zA-Z_$][\w$]*)\]/g,
      (_m, key, v) => {
        const name = v.slice(1)
        const val = get(name)
        if (val === undefined) return wildcardDynamic ? '[*]' : _m
        const rendered =
          typeof val === 'number' || typeof val === 'boolean'
            ? String(val)
            : JSON.stringify(String(val))
        return `[${key}=${rendered}]`
      },
    )

    // [$var]
    s = s.replace(/\[\s*(\$[a-zA-Z_$][\w$]*)\s*\]/g, (_m, v) => {
      const name = v.slice(1)
      const val = get(name)
      if (typeof val === 'number' && Number.isFinite(val)) return `[${val}]`
      return wildcardDynamic ? '[*]' : _m
    })

    // [$var] уже обработали выше.
    // БАЛАНСНЫЙ ПРОХОД ПО СКОБКАМ: если внутри [...] осталась '$' — при wildcardDynamic сворачиваем в [*]
    if (wildcardDynamic) {
      let out = ''
      const n = s.length
      let i = 0
      while (i < n) {
        const ch = s[i]
        if (ch !== '[') {
          out += ch
          i++
          continue
        }

        // читаем сбалансированный блок [ ... ] с учётом вложенных скобок и кавычек
        const start = i
        i++ // пропустили '['
        let depth = 1
        let inSingle = false
        let inDouble = false

        while (i < n && depth > 0) {
          const c = s[i]

          if (c === '\\') {
            // экранирование внутри кавычек
            out // ничего, просто перепрыгиваем символ
            i += 2
            continue
          }

          if (inSingle) {
            if (c === '\'') inSingle = false
            i++
            continue
          }
          if (inDouble) {
            if (c === '"') inDouble = false
            i++
            continue
          }

          if (c === '\'') {
            inSingle = true
            i++
            continue
          }
          if (c === '"') {
            inDouble = true
            i++
            continue
          }
          if (c === '[') {
            depth++
            i++
            continue
          }
          if (c === ']') {
            depth--
            i++
            continue
          }

          i++
        }

        // теперь [start, i) — весь скобочный сегмент
        const inner = s.slice(start + 1, i - 1)

        // если внутри осталась "$" (любая неразрешённая переменная), то сворачиваем в [*]
        if (inner.includes('$')) {
          out += '[*]'
        } else {
          out += '[' + inner + ']'
        }
      }
      s = out
    }

    // $key (dot)
    s = s.replace(/(^|\.)(\$[a-zA-Z_$][\w$]*)(?=\.|\[|$)/g, (_m, lead, v) => {
      const name = v.slice(1)
      const val = get(name)
      if (val === undefined) return wildcardDynamic ? `${lead}*` : `${lead}${v}`
      const key = String(val)
      if (!/^[a-zA-Z_$][\w$]*$/.test(key)) return `${lead}${v}`
      return `${lead}${key}`
    })

    return s
  }

  private static _parseSegments(path: string): DataPathSegment[] {
    const segs: DataPathSegment[] = []
    const n = path.length
    let i = 0

    while (i < n) {
      // пропускаем точки
      if (path[i] === '.') {
        i++
        continue
      }

      // блок в квадратных скобках
      if (path[i] === '[') {
        i++ // пропустить '['
        let depth = 1
        const sb: string[] = []
        while (i < n && depth > 0) {
          const ch = path[i]

          // строковые литералы
          if (ch === '"' || ch === "'") {
            const q = ch
            sb.push(ch)
            i++
            while (i < n) {
              const c2 = path[i]
              sb.push(c2)
              i++
              if (c2 === '\\') {
                if (i < n) {
                  sb.push(path[i])
                  i++
                }
                continue
              }
              if (c2 === q) break
            }
            continue
          }

          if (ch === '[') {
            depth++
            sb.push(ch)
            i++
            continue
          }

          if (ch === ']') {
            depth--
            if (depth === 0) {
              i++ // съели ']'
              break
            }
            sb.push(ch)
            i++
            continue
          }

          sb.push(ch)
          i++
        }

        const inner = sb.join('').trim()
        if (inner.length === 0) continue

        // [123] — точный индекс
        if (/^\d+$/.test(inner)) {
          segs.push({ kind: SegKind.Index, index: Number(inner) })
          continue
        }

        // [*] — индексный wildcard
        if (inner === '*') {
          segs.push({ kind: SegKind.Wildcard, asIndex: true } as any)
          continue
        }

        // [$name] — плейсхолдер индекса
        if (/^\$[A-Za-z_]\w*$/.test(inner)) {
          segs.push({ kind: SegKind.Param, pkey: '$index', pval: inner })
          continue
        }

        // [key=value] (value может быть с кавычками или без)
        const kv = inner.match(/^([a-zA-Z_$][\w\d_$]*)\s*=\s*(.+)$/)
        if (kv) {
          const pkey = kv[1]
          let rawVal = kv[2].trim()
          const quoted =
            (rawVal.startsWith('"') && rawVal.endsWith('"')) ||
            (rawVal.startsWith("'") && rawVal.endsWith("'"))
          if (quoted) rawVal = rawVal.slice(1, -1)

          if (!quoted && rawVal.startsWith('$')) {
            segs.push({ kind: SegKind.Param, pkey, pval: rawVal })
            continue
          }

          const pval: ParamValue =
            !quoted && /^\d+$/.test(rawVal) ? Number(rawVal) : rawVal
          segs.push({ kind: SegKind.Param, pkey, pval })
          continue
        }

        // fallback — трактуем как ключ внутри []
        segs.push({ kind: SegKind.Key, key: inner })
        continue
      }

      // дот-сегмент до '.' или '['
      const start = i
      while (i < n && path[i] !== '.' && path[i] !== '[') i++
      const raw = path.slice(start, i).trim()
      if (raw.length === 0) continue

      if (raw === '*') {
        // ключевой wildcard (dot)
        segs.push({ kind: SegKind.Wildcard, asIndex: false } as any)
      } else if (raw.startsWith('$')) {
        // сегмент-ключ, начинающийся с $ — считаем wildcard одного сегмента (dot)
        segs.push({ kind: SegKind.Wildcard, asIndex: false } as any)
      } else {
        segs.push({ kind: SegKind.Key, key: raw })
      }
    }

    return segs
  }

  /** JSON -> DataPath */
  static fromPlain(plain: Record<string, any>): DataPath {
    const src = Array.isArray(plain?.segs) ? plain.segs : []
    const segs: DataPathSegment[] = []
    for (const s of src) {
      if (!s || typeof s !== 'object') continue
      switch (s.t) {
        case 'key':
          segs.push({ kind: SegKind.Key, key: s.k })
          break
        case 'idx':
          segs.push({ kind: SegKind.Index, index: s.i | 0 })
          break
        case 'wc':
          segs.push({ kind: SegKind.Wildcard })
          break
        case 'param':
          segs.push({ kind: SegKind.Param, pkey: s.pk, pval: s.pv })
          break
      }
    }
    const dp = new DataPath(segs)
    if (plain?.deepOnTail && segs.length > 0) {
      const last = segs[segs.length - 1] as any
      if (last.kind === SegKind.Wildcard && !last.asIndex) {
        last.deepWildcard = true
      }
    }
    return dp
  }

  toPlain(): Record<string, any> {
    const segs = this._segs.map((s) => {
      switch (s.kind) {
        case SegKind.Key:
          return { t: 'key', k: (s as any).key }
        case SegKind.Index:
          return { t: 'idx', i: (s as any).index }
        case SegKind.Wildcard:
          return { t: 'wc' }
        case SegKind.Param:
          return { t: 'param', pk: (s as any).pkey, pv: (s as any).pval }
      }
    })
    const last = this._segs[this._segs.length - 1] as any
    const deepOnTail =
      this._segs.length > 0 && last.kind === SegKind.Wildcard && !last.asIndex
    return { segs, deepOnTail }
  }

  toStringPath(): string {
    const cached = DataPath._cacheToString.get(this)
    if (cached) return cached

    let out = ''
    const pushDotKey = (k: string) => {
      if (out.length === 0) out += k
      else out += '.' + k
    }

    for (let i = 0; i < this._segs.length; i++) {
      const s = this._segs[i] as any
      switch (s.kind) {
        case SegKind.Key:
          pushDotKey(s.key!)
          break
        case SegKind.Index:
          out += `[${s.index}]`
          break
        case SegKind.Wildcard: {
          const asIndex = s.asIndex === true
          if (asIndex) {
            // индексный wildcard
            out += '[*]'
          } else {
            // ключевой wildcard
            if (out.length === 0 || out.endsWith(']') || out.endsWith('*')) {
              out += '*'
            } else {
              out += '.*'
            }
          }
          break
        }
        case SegKind.Param:
          out += `[${s.pkey}=${
            typeof s.pval === 'number' ? s.pval : JSON.stringify(s.pval)
          }]`
          break
      }
    }

    DataPath._cacheToString.set(this, out)
    return out
  }

  /** Копия массива сегментов */
  segments(): ReadonlyArray<DataPathSegment> {
    return this._segs
  }

  /** Сопоставление маски и цели по правилам */
  static match(
    mask: string | DataPath | Record<string, any>,
    target: string | DataPath | Record<string, any>,
  ): boolean {
    const m = DataPath.from(mask)._segs as any[]
    const t = DataPath.from(target)._segs as any[]
    let i = 0
    let j = 0

    while (i < m.length) {
      const ms = m[i]

      // глубокий wildcard на конце (ключевой '*')
      if (ms.kind === SegKind.Wildcard && !ms.asIndex && i === m.length - 1) {
        return true
      }

      if (j >= t.length) return false
      const ts = t[j]

      switch (ms.kind) {
        case SegKind.Key:
          if (ts.kind !== SegKind.Key || ts.key !== ms.key) return false
          break
        case SegKind.Index:
          if (ts.kind !== SegKind.Index || ts.index !== ms.index) return false
          break
        case SegKind.Wildcard:
          // одиночный wildcard — совпадает с любым одним сегментом
          // (Key | Index | Param | Wildcard)
          break
        case SegKind.Param:
          if (ts.kind !== SegKind.Param) return false
          if (ts.pkey !== ms.pkey) return false
          if (ts.pval !== ms.pval) return false
          break
      }

      i++
      j++
    }

    return j === t.length
  }
}
