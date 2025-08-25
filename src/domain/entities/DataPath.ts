import type { DataPathSegment, ParamValue } from '@/domain/types/path.types'
import { SegKind } from '@/domain/types/path.types'

/**
 * Лёгкая модель пути с парсером строкового формата:
 *  - Дот‑сегменты: com.x.y
 *  - Индексы/параметры в []: [5], [*], [id=10], [name="foo"]
 */
// Правила:
//  - '*' в середине пути - wildcard ровно одного сегмента
//  - '*' последним сегментом без параметров - глубокий wildcard (совпадает с любой остаточной глубиной, включая пустую)
//  - Индекс массива: [5]
//  - Параметризованный выбор элемента массива: [id=10]
//  - Подписка на все элементы массива: [*]
//  - id=* (значение-параметр wildcard) — НЕ поддерживаем по требованиям
//
export class DataPath {
  //
  //
  private readonly _segs: DataPathSegment[]

  //
  // Глобальный кеш по ключу
  //
  static _cacheFromString = new Map<string, DataPath>()
  static _cacheToString = new WeakMap<DataPath, string>()
  static _cacheSegments = new Map<string, DataPathSegment[]>()

  private constructor(segs: DataPathSegment[]) {
    this._segs = segs

    //
    // помечаем последний '*' (без параметров) как глубокий
    if (this._segs.length > 0) {
      const last = this._segs[this._segs.length - 1]
      if (last.kind === SegKind.Wildcard) last.deepWildcard = true
    }
  }

  static from(
    input: string | DataPath | Record<string, any>,
    opts?: { vars?: Record<string, unknown> },
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
    opts?: { vars?: Record<string, unknown> },
  ): DataPath {
    if (!path) return new DataPath([])

    // если есть vars — интерполируем; кеш ключ привяжем к итоговой строке
    path = opts?.vars ? DataPath._interpolate(path, opts.vars) : path

    // Если уже готов DataPath
    const cached = DataPath._cacheFromString.get(path)
    if (cached) return cached

    // Если уже есть разобранные сегменты
    const segsFromCache = DataPath._cacheSegments.get(path)
    const segs = segsFromCache ?? DataPath._parseSegments(path)

    // Кешируем сегменты (если парсили)
    if (!segsFromCache) {
      DataPath._cacheSegments.set(path, segs)
    }

    const dp = new DataPath(segs)
    DataPath._cacheFromString.set(path, dp)

    return dp
  }

  /**
   * Простейшая интерполяция $vars в ключах, индексах и значениях параметров.
   */
  private static _interpolate(
    src: string,
    vars: Record<string, unknown>,
  ): string {
    const get = (name: string) => {
      if (!(name in vars))
        throw new Error(`DataPath: variable "${name}" is not provided`)
      return vars[name]
    }

    let s = src

    // [id=$var] — значение подставим с кавычками для строк
    s = s.replace(
      /\[([a-zA-Z_$][\w$]*)\s*=\s*(\$[a-zA-Z_$][\w$]*)\]/g,
      (_m, key, v) => {
        const name = v.slice(1)
        const val = get(name)
        const rendered =
          typeof val === 'number' || typeof val === 'boolean'
            ? String(val)
            : JSON.stringify(String(val))
        return `[${key}=${rendered}]`
      },
    )

    // [$var] — индекс массива (требуем число/boolean->число недопустим)
    s = s.replace(/\[\s*(\$[a-zA-Z_$][\w$]*)\s*\]/g, (_m, v) => {
      const name = v.slice(1)
      const val = get(name)
      if (typeof val !== 'number' || !Number.isFinite(val)) {
        throw new Error(
          `DataPath: variable "${name}" must be a finite number for index segment`,
        )
      }
      return `[${val}]`
    })

    // $key или начало строки $key  — ключ сегмента
    // Поддерживаем form: "foo.$k.bar" и "$k.bar"
    s = s.replace(/(^|\.)(\$[a-zA-Z_$][\w$]*)(?=\.|\[|$)/g, (_m, lead, v) => {
      const name = v.slice(1)
      const val = get(name)
      const key = String(val)
      if (!/^[a-zA-Z_$][\w$]*$/.test(key)) {
        throw new Error(
          `DataPath: variable "${name}" must be a valid identifier for key segment`,
        )
      }
      return `${lead}${key}`
    })

    return s
  }

  private static _parseSegments(path: string): DataPathSegment[] {
    const segs: DataPathSegment[] = []
    const re = /([^\.\[\]]+)|\[(.+?)\]/g
    let m: RegExpExecArray | null

    while ((m = re.exec(path)) !== null) {
      if (m[1]) {
        const raw = m[1]
        segs.push(
          raw === '*'
            ? { kind: SegKind.Wildcard }
            : { kind: SegKind.Key, key: raw },
        )
        continue
      }

      const inner = m[2].trim()

      if (/^\$[A-Za-z_]\w*$/.test(inner)) {
        // кодируем как Param со спец-ключом "$index"
        segs.push({ kind: SegKind.Param, pkey: '$index', pval: inner })
        continue
      }

      if (inner === '*') {
        segs.push({ kind: SegKind.Wildcard })
        continue
      }

      if (/^\d+$/.test(inner)) {
        segs.push({ kind: SegKind.Index, index: Number(inner) })
        continue
      }

      // внутри DataPath._parseSegments, в блоке kv:
      const kv = inner.match(/^([a-zA-Z_$][\w\d_$]*)\s*=\s*(.+)$/)
      if (kv) {
        const pkey = kv[1]
        let rawVal = kv[2].trim()
        const quoted =
          (rawVal.startsWith('"') && rawVal.endsWith('"')) ||
          (rawVal.startsWith('\'') && rawVal.endsWith('\''))
        if (quoted) rawVal = rawVal.slice(1, -1)

        // если rawVal — placeholder (начинается с '$'), запомним как строку '$name'
        if (!quoted && rawVal.startsWith('$')) {
          //
          // Placeholder: сохраняем pval как строку с $ — признак плейсхолдера
          segs.push({ kind: SegKind.Param, pkey, pval: rawVal })
          continue
        }

        const pval: ParamValue =
          !quoted && /^\d+$/.test(rawVal) ? Number(rawVal) : rawVal
        segs.push({ kind: SegKind.Param, pkey, pval })
        continue
      }

      segs.push({ kind: SegKind.Key, key: inner })
    }

    return segs
  }

  /**
   * JSON‑представление (plain):
   * {
   *   segs: [
   *     { t:'key', k:'com' },
   *     { t:'param', pk:'id', pv:10 },
   *     { t:'key', k:'x' }
   *   ],
   *   deepOnTail: true|false
   * }
   */
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
      const last = segs[segs.length - 1]
      if (last.kind === SegKind.Wildcard) last.deepWildcard = true
    }
    return dp
  }

  toPlain(): Record<string, any> {
    const segs = this._segs.map((s) => {
      switch (s.kind) {
        case SegKind.Key:
          return { t: 'key', k: s.key }
        case SegKind.Index:
          return { t: 'idx', i: s.index }
        case SegKind.Wildcard:
          return { t: 'wc' }
        case SegKind.Param:
          return { t: 'param', pk: s.pkey, pv: s.pval }
      }
    })
    const deepOnTail =
      this._segs.length > 0 &&
      this._segs[this._segs.length - 1].kind === SegKind.Wildcard
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
      const s = this._segs[i]
      switch (s.kind) {
        case SegKind.Key:
          pushDotKey(s.key!)
          break
        case SegKind.Index:
          out += `[${s.index}]`
          break
        case SegKind.Wildcard:
          // '*' как дот‑сегмент или как [*] — сериализуем в '*'
          // Если перед wildcard не было дот‑ключа/индекса — добавление через '.'
          // пример: com.*.x  | com[*].x — пишем как com.*.x
          if (out.length === 0 || out.endsWith(']') || out.endsWith('*')) {
            // редкий случай — пусть будет просто '*'
            out += '*'
          } else {
            out += '.*'
          }
          break
        case SegKind.Param:
          out += `[${s.pkey}=${typeof s.pval === 'number' ? s.pval : JSON.stringify(s.pval)}]`
          break
      }
    }

    //
    //
    DataPath._cacheToString.set(this, out)
    return out
  }

  /**
   * Возвращает копию массива сегментов (для матчеров/роутера)
   */
  segments(): ReadonlyArray<DataPathSegment> {
    return this._segs
  }

  /**
   * Совпадение по правилам проекта (см. комментарии вверху файла)
   */
  static match(
    mask: string | DataPath | Record<string, any>,
    target: string | DataPath | Record<string, any>,
  ): boolean {
    const m = DataPath.from(mask)._segs
    const t = DataPath.from(target)._segs
    let i = 0
    let j = 0

    while (i < m.length) {
      const ms = m[i]

      // глубокий wildcard на конце (последний сегмент = '*')
      if (ms.kind === SegKind.Wildcard && i === m.length - 1) {
        return true // съедаем любой хвост (включая пустой)
      }

      if (j >= t.length) return false
      const ts = t[j]

      // обычный шаг сравнения
      switch (ms.kind) {
        case SegKind.Key:
          if (ts.kind !== SegKind.Key || ts.key !== ms.key) return false
          break
        case SegKind.Index:
          if (ts.kind !== SegKind.Index || ts.index !== ms.index) return false
          break
        case SegKind.Wildcard:
          // одиночный wildcard — совпадает с ЛЮБЫМ одним сегментом
          // (key | index | param)
          // ничего не проверяем, просто «съедаем» ровно один ts
          break
        case SegKind.Param:
          if (ts.kind !== SegKind.Param) return false
          if (ts.pkey !== ms.pkey) return false
          if (ts.pval !== ms.pval) return false // без '*' в значении
          break
      }

      i++
      j++
    }

    // маска закончилась — цель тоже должна быть исчерпана
    return j === t.length
  }
}
