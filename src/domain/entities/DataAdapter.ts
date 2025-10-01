import type {
  DataAdapter,
  DataObject,
  DataPathDef,
  DefaultAdapterOptions,
} from '@/domain/types/base.types'
import { DataPath } from '@/domain/entities/DataPath'
import { SegKind } from '@/domain/types/path.types'

/**
 * In-memory адаптер поверх корневого объекта с путями в формате нового DataPath.
 *
 * Поддерживает:
 *   rows[0].status
 *   rows[id=7].status
 *   scene.layers[id="5"].props.x
 *
 * Ограничения:
 *   - Одиночный wildcard ('*' или '[*]') в CRUD — НЕ поддержан (бросаем ошибку).
 *   - Параметризованный доступ (SegKind.Param) предполагает, что контейнер — массив.
 *   - autoCreate=true создаёт промежуточные узлы (объект/массив) по ходу set().
 *
 * Индексация:
 *   - indexEnabled: включает ленивую/жадную индексацию для путей вида [key=value]
 *   - indexStrategy:
 *       - 'eager-all-keys' — при первой необходимости массив целиком индексируется
 *         по всем "простым" (string|number|boolean) полям его объектов.
 *       - 'lazy-key'       — индексы собираются только для конкретного ключа pkey.
 *   - Индексы автоматически инвалидируются при операциях splice / грубых заменах.
 */
export class DefaultDataAdapter implements DataAdapter {
  private _root: DataObject
  private _opts: Required<DefaultAdapterOptions>

  /** WeakMap: array -> (paramKey -> (value -> index)) */
  private _indexes: WeakMap<any[], Map<string, Map<any, number>>> =
    new WeakMap()
  /** WeakMap: array -> dirty flag (true => нужно перестроить индексы при следующем обращении) */
  private _indexDirty: WeakMap<any[], boolean> = new WeakMap()

  constructor(initial: DataObject = {}, opts?: DefaultAdapterOptions) {
    this._root = initial
    this._opts = {
      arrayDelete: opts?.arrayDelete ?? 'unset', // 'unset' | 'splice'
      autoCreate: opts?.autoCreate ?? true,
      indexEnabled: opts?.indexEnabled ?? true,
      indexStrategy: opts?.indexStrategy ?? 'eager-all-keys',
    }
  }

  /** Применить опции (можно менять indexEnabled на лету) */
  options(next: Partial<DefaultAdapterOptions>): void {
    if (next.arrayDelete) this._opts.arrayDelete = next.arrayDelete
    if (typeof next.autoCreate === 'boolean')
      this._opts.autoCreate = next.autoCreate

    if (typeof next.indexEnabled === 'boolean') {
      const prev = this._opts.indexEnabled
      this._opts.indexEnabled = next.indexEnabled
      if (!this._opts.indexEnabled && prev) {
        // Выключили индексы — полностью очистим
        this._clearAllIndexes()
      }
    }

    if (next.indexStrategy !== undefined) {
      this._opts.indexStrategy = next.indexStrategy
      // Смена стратегии: проще пометить всё грязным, пересоберём по требованию
      this._clearAllIndexes()
    }
  }

  /** Прямой доступ к корню (для интеграции/отладки). */
  root(): DataObject {
    return this._root
  }

  /** Полностью заменить корень (сбросить индексы). */
  replaceRoot(next: DataObject): void {
    this._root = next
    this._clearAllIndexes()
  }

  // ====================== CRUD ======================

  get(path: DataPathDef, opts?: { vars?: Record<string, any> }): unknown {
    const segs = DataPath.from(path, opts).segments()
    let cur: any = this._root

    for (const s of segs) {
      if (cur == null) return undefined

      switch (s.kind) {
        case SegKind.Key: {
          const k = (s.key || '') as string
          if (k && k.startsWith('$')) {
            const varName = k.slice(1)
            if (
              opts?.vars &&
              Object.prototype.hasOwnProperty.call(opts.vars, varName)
            ) {
              cur = opts.vars[varName]
              break
            }
          }
          cur = cur?.[k as any]
          break
        }

        case SegKind.Index:
          cur = Array.isArray(cur) ? cur[s.index as number] : undefined
          break

        case SegKind.Param: {
          if (!Array.isArray(cur)) {
            throw new Error('get: параметризованный доступ ожидает массив')
          }
          const idx = this._findIndexByParam(cur, s.pkey!, s.pval!, opts)
          if (idx === -1) return undefined
          cur = cur[idx]
          break
        }

        case SegKind.Wildcard:
          throw new Error('get: wildcard "*" без параметров не поддерживается')
      }
    }

    return cur
  }

  set(
    path: DataPathDef,
    value: unknown,
    opts?: { vars?: Record<string, any> },
  ): void {
    const segs = DataPath.from(path, opts).segments()
    if (segs.length === 0) {
      this._root = value as DataObject
      this._clearAllIndexes()
      return
    }

    let cur: any = this._root

    for (let i = 0; i < segs.length - 1; i++) {
      const s = segs[i]
      const nextSeg = segs[i + 1]

      switch (s.kind) {
        case SegKind.Key: {
          let next = cur?.[s.key as any]
          if (next == null && this._opts.autoCreate) {
            const makeArray =
              nextSeg.kind === SegKind.Index || nextSeg.kind === SegKind.Param
            next = makeArray ? [] : {}
            if (cur == null) {
              throw new Error(
                `set: не можем создать контейнер под "${String(s.key)}" — родитель null/undefined`,
              )
            }
            cur[s.key as any] = next
          }
          cur = next
          if (cur == null) {
            throw new Error(
              `set: cannot traverse at "${String(s.key)}" (autoCreate=false)`,
            )
          }
          break
        }

        case SegKind.Index: {
          if (!Array.isArray(cur))
            throw new Error('set: ожидался массив для индекса')
          const arr: any[] = cur
          const idx = s.index as number

          if (arr[idx] == null && this._opts.autoCreate) {
            const makeArray =
              nextSeg.kind === SegKind.Index || nextSeg.kind === SegKind.Param
            arr[idx] = makeArray ? [] : {}
          }

          cur = arr[idx]
          if (cur == null) {
            throw new Error('set: cannot traverse by index (autoCreate=false)')
          }
          break
        }

        case SegKind.Param: {
          if (!Array.isArray(cur))
            throw new Error('set: параметризованный доступ ожидает массив')

          const arr = cur as any[]
          const pkey = s.pkey!
          let pval: unknown = s.pval!
          if (typeof pval === 'string' && pval.startsWith('$')) {
            pval = this.get(pval, opts)
          }

          let idx = this._findIndexByParam(arr, pkey, pval, opts)
          if (idx === -1) {
            if (!this._opts.autoCreate) {
              throw new Error(
                'set: элемент по [param=value] не найден (autoCreate=false)',
              )
            }
            const created: Record<string, unknown> = { [pkey]: pval }
            idx = arr.push(created) - 1

            // Поддержим индексы при вставке:
            this._indexUpsert(arr, pkey, pval, idx)
            if (
              this._opts.indexEnabled &&
              this._opts.indexStrategy === 'eager-all-keys'
            ) {
              const byKey = this._indexes.get(arr)
              if (byKey) {
                for (const k of Object.keys(created)) {
                  const v = (created as any)[k]
                  if (v == null) continue
                  const t = typeof v
                  if (t === 'string' || t === 'number' || t === 'boolean') {
                    let bucket = byKey.get(k)
                    if (!bucket) {
                      bucket = new Map<any, number>()
                      byKey.set(k, bucket)
                    }
                    bucket.set(v, idx)
                  }
                }
              }
            }
          }

          cur = arr[idx]
          break
        }

        case SegKind.Wildcard:
          throw new Error('set: wildcard "*" без параметров не поддерживается')
      }
    }

    // Лист
    const leaf = segs[segs.length - 1]
    switch (leaf.kind) {
      case SegKind.Key: {
        if (cur == null) {
          if (!this._opts.autoCreate)
            throw new Error('set: target container is null (autoCreate=false)')
          cur = {}
        }
        cur[leaf.key as any] = value
        break
      }

      case SegKind.Index: {
        if (!Array.isArray(cur))
          throw new Error('set: ожидался массив для индекса в листе')
        const arr = cur as any[]
        const i = leaf.index as number
        arr[i] = value

        // Заменили элемент по индексу: индексы могли устареть по множеству ключей.
        // Самый безопасный и быстрый подход — пометить массив грязным.
        if (this._opts.indexEnabled) {
          this._indexDirty.set(arr, true)
        }
        break
      }

      case SegKind.Param: {
        if (!Array.isArray(cur))
          throw new Error('set: параметризованный лист ожидает массив')
        if (!this._isPlainObject(value)) {
          throw new Error(
            'set: значение для [param=value] должно быть plain-object',
          )
        }

        const arr = cur as any[]
        const pkey = leaf.pkey!
        let pval: unknown = leaf.pval!
        if (typeof pval === 'string' && pval.startsWith('$')) {
          pval = this.get(pval, opts)
        }

        let idx = this._findIndexByParam(arr, pkey, pval, opts)
        if (idx === -1) {
          if (!this._opts.autoCreate) {
            throw new Error(
              'set: элемент по [param=value] не найден (autoCreate=false)',
            )
          }
          const created: Record<string, unknown> = { [pkey]: pval }
          idx = arr.push(created) - 1
        }

        const el = arr[idx]
        if (!this._isPlainObject(el)) {
          throw new Error(
            'set: целевой элемент по [param=value] не является объектом',
          )
        }

        // Сохраняем ссылочную стабильность: чистим и мёржим
        Object.keys(el).forEach((k) => delete (el as any)[k])
        Object.assign(el, value as object)
        ;(el as any)[pkey] = pval

        // Индекс актуализируем
        this._indexUpsert(arr, pkey, pval, idx)
        break
      }

      case SegKind.Wildcard:
        throw new Error('set: wildcard "*" без параметров не поддерживается')
    }
  }

  delete(path: DataPathDef, opts?: { vars?: Record<string, any> }): void {
    const segs = DataPath.from(path, opts).segments()

    if (segs.length === 0) {
      this._root = {}
      this._clearAllIndexes()
      return
    }

    // Доходим до родителя листа
    let cur: any = this._root
    for (let i = 0; i < segs.length - 1; i++) {
      const s = segs[i]
      if (cur == null) return

      switch (s.kind) {
        case SegKind.Key:
          cur = cur[s.key as any]
          break
        case SegKind.Index:
          if (!Array.isArray(cur)) return
          cur = cur[s.index as number]
          break
        case SegKind.Param: {
          if (!Array.isArray(cur)) return
          const idx = this._findIndexByParam(cur, s.pkey!, s.pval!, opts)
          if (idx === -1) return
          cur = cur[idx]
          break
        }
        case SegKind.Wildcard:
          throw new Error(
            'delete: wildcard "*" без параметров не поддерживается',
          )
      }
    }

    const leaf = segs[segs.length - 1]
    if (cur == null) return

    switch (leaf.kind) {
      case SegKind.Key:
        delete cur[leaf.key as any]
        break

      case SegKind.Index: {
        if (!Array.isArray(cur)) return
        const arr = cur as any[]
        const i = leaf.index as number
        if (this._opts.arrayDelete === 'splice') {
          if (i >= 0 && i < arr.length) {
            arr.splice(i, 1)
            this._indexInvalidateArray(arr) // сдвиг индексов — полная инвалидация
          }
        } else {
          delete arr[i]
          // unset по индексу — мы не знаем, какие pkey/pval убрать из индекса;
          // оставляем как есть (при следующем обращении индекс может быть скорректирован линейным поиском).
        }
        break
      }

      case SegKind.Param: {
        if (!Array.isArray(cur)) return
        const arr = cur as any[]
        const pkey = leaf.pkey!
        let pval: unknown = leaf.pval!
        if (typeof pval === 'string' && pval.startsWith('$')) {
          pval = this.get(pval, opts)
        }
        const idx = this._findIndexByParam(arr, pkey, pval, opts)
        if (idx === -1) return

        if (this._opts.arrayDelete === 'splice') {
          arr.splice(idx, 1)
          this._indexInvalidateArray(arr)
        } else {
          delete arr[idx]
          this._indexDeleteValue(arr, pkey, pval) // точечная чистка
        }
        break
      }

      case SegKind.Wildcard:
        throw new Error('delete: wildcard "*" без параметров не поддерживается')
    }
  }

  merge(
    path: DataPathDef,
    value: unknown,
    opts?: { vars?: Record<string, any> },
  ): void {
    const target = this.get(path, opts)
    if (this._isPlainObject(target) && this._isPlainObject(value)) {
      Object.assign(target as object, value as object)
      // Технически могли затронуть ключи индекса (если target — элемент массива),
      // но без контекста массива здесь сложно определить. Оставляем ленивую коррекцию.
      return
    }
    this.set(path, value, opts)
  }

  /** Вернуть индекс элемента массива, на который указывает путь (если последний сегмент — Index/Param). */
  indexOf(path: DataPathDef, opts?: { vars?: Record<string, any> }): number {
    const segs = DataPath.from(path, opts).segments()
    if (segs.length === 0) return -1

    let cur: any = this._root

    for (let i = 0; i < segs.length; i++) {
      const s = segs[i]
      const last = i === segs.length - 1

      switch (s.kind) {
        case SegKind.Key: {
          const k = (s.key || '') as string
          if (k && k.startsWith('$')) {
            const varName = k.slice(1)
            if (
              opts?.vars &&
              Object.prototype.hasOwnProperty.call(opts.vars, varName)
            ) {
              cur = opts.vars[varName]
              break
            }
          }
          cur = cur?.[k as any]
          if (cur == null) return -1
          break
        }

        case SegKind.Index: {
          if (!Array.isArray(cur)) return -1
          if (last) return s.index as number
          cur = cur[s.index as number]
          if (cur == null) return -1
          break
        }

        case SegKind.Param: {
          if (!Array.isArray(cur)) return -1
          const idx = this._findIndexByParam(cur, s.pkey!, s.pval!, opts)
          if (idx === -1) return -1
          if (last) return idx
          cur = cur[idx]
          if (cur == null) return -1
          break
        }

        case SegKind.Wildcard:
          return -1
      }
    }

    return -1
  }

  // ====================== Индексация ======================

  /** Найти индекс элемента по паре (pkey, pval) с учётом индексов либо линейно. */
  private _findIndexByParam(
    arr: any[],
    pkey: string,
    pval: unknown,
    opts?: { vars?: Record<string, any> },
  ): number {
    if (typeof pval === 'string' && pval.startsWith('$')) {
      pval = this.get(pval, opts)
    }

    if (!this._opts.indexEnabled) {
      return this._linearFindIndex(arr, pkey, pval)
    }

    const bucket = this._ensureIndex(arr, pkey)
    if (bucket.has(pval)) return bucket.get(pval)!

    // не нашли в индексе — проверим линейно и дополним индекс
    const idx = this._linearFindIndex(arr, pkey, pval)
    if (idx !== -1) {
      bucket.set(pval, idx)
    }
    return idx
  }

  /** Гарантирует, что у массива есть актуальные индексы; создаёт/перестраивает по стратегии. */
  private _ensureIndex(arr: any[], pkey: string): Map<any, number> {
    let byKey = this._indexes.get(arr)
    const dirty = this._indexDirty.get(arr) === true

    if (!byKey || dirty) {
      byKey = new Map<string, Map<any, number>>()
      this._indexes.set(arr, byKey)
      this._indexDirty.set(arr, false)

      if (this._opts.indexStrategy === 'eager-all-keys') {
        // Полная перестройка по всем простым ключам всех объектов массива
        for (let i = 0; i < arr.length; i++) {
          const el = arr[i]
          if (!this._isPlainObject(el)) continue
          for (const k of Object.keys(el)) {
            const v = (el as any)[k]
            if (v == null) continue
            const t = typeof v
            if (t !== 'string' && t !== 'number' && t !== 'boolean') continue
            let bucket = byKey.get(k)
            if (!bucket) {
              bucket = new Map<any, number>()
              byKey.set(k, bucket)
            }
            bucket.set(v, i) // последний увиденный индекс для данного значения
          }
        }
      }
    }

    // В lazy-key режиме (или если у eager ещё нет такого ключа) — дособерём только запрошенный pkey.
    let bucket = byKey.get(pkey)
    if (!bucket) {
      bucket = new Map<any, number>()
      for (let i = 0; i < arr.length; i++) {
        const el = arr[i]
        if (!this._isPlainObject(el)) continue
        const v = (el as any)[pkey]
        if (v == null) continue
        const t = typeof v
        if (t !== 'string' && t !== 'number' && t !== 'boolean') continue
        bucket.set(v, i)
      }
      byKey.set(pkey, bucket)
    }

    return bucket
  }

  /** Простой линейный поиск (fallback/наполнение индекса) */
  private _linearFindIndex(arr: any[], pkey: string, pval: unknown): number {
    for (let i = 0; i < arr.length; i++) {
      const el = arr[i]
      if (!this._isPlainObject(el)) continue
      if ((el as any)[pkey] === pval) return i
    }
    return -1
  }

  /** Обновить/вставить значение в индекс (если индекс уже существует). */
  private _indexUpsert(
    arr: any[],
    pkey: string,
    pval: unknown,
    idx: number,
  ): void {
    if (!this._opts.indexEnabled) return
    const byKey = this._indexes.get(arr)
    if (!byKey) return // индексы построятся при первом чтении
    let bucket = byKey.get(pkey)
    if (!bucket) {
      bucket = new Map<any, number>()
      byKey.set(pkey, bucket)
    }
    bucket.set(pval, idx)
  }

  /** Точечное удаление значения из индекса (для unset по Param). */
  private _indexDeleteValue(arr: any[], pkey: string, pval: unknown): void {
    if (!this._opts.indexEnabled) return
    const byKey = this._indexes.get(arr)
    if (!byKey) return
    const bucket = byKey.get(pkey)
    if (!bucket) return
    bucket.delete(pval)
  }

  /** Полная инвалидация индексов конкретного массива (например, после splice). */
  private _indexInvalidateArray(arr: any[]): void {
    if (!this._opts.indexEnabled) return
    this._indexes.delete(arr)
    this._indexDirty.set(arr, true)
  }

  /** Полная очистка всех индексов (смена root/опций). */
  private _clearAllIndexes(): void {
    this._indexes = new WeakMap()
    this._indexDirty = new WeakMap()
  }

  // ====================== Вспомогательное ======================

  private _isPlainObject(x: unknown): x is Record<string, unknown> {
    return typeof x === 'object' && x !== null && !Array.isArray(x)
  }
}
