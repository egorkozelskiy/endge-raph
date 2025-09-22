import type {
  DataAdapter,
  DataObject,
  DataPathDef,
  DefaultAdapterOptions,
} from '@/domain/types/base.types'
import { DataPath } from '@/domain/entities/DataPath'
import { SegKind } from '@/domain/types/path.types'

/**
 * In‑memory адаптер поверх корневого объекта с путями в формате нового DataPath.
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
 */
export class DefaultDataAdapter implements DataAdapter {
  private _root: DataObject
  private _opts: Required<DefaultAdapterOptions>

  constructor(initial: DataObject = {}, opts?: DefaultAdapterOptions) {
    this._root = initial
    this._opts = {
      arrayDelete: opts?.arrayDelete ?? 'unset', // 'unset' | 'splice'
      autoCreate: opts?.autoCreate ?? true,
    }
  }

  /**
   * Прямой доступ к корню (для интеграции/отладки).
   */
  root(): DataObject {
    return this._root
  }

  /**
   * Полностью заменить корень.
   */
  replaceRoot(next: DataObject): void {
    this._root = next
  }

  get(
    path: DataPathDef,
    opts?: {
      vars?: Record<string, any>
    },
  ): unknown {
    const segs = DataPath.from(path, opts).segments()
    let cur: any = this._root

    for (const s of segs) {
      if (cur == null) return undefined

      switch (s.kind) {
        case SegKind.Key:
          const k = (s?.key || '') as string
          if (k && k.startsWith('$')) {
            const varName = k.slice(1)
            if (
              opts?.vars &&
              Object.prototype.hasOwnProperty.call(opts.vars, varName)
            ) {
              // используем переменную как новую «базу» для дальнейшей навигации
              cur = opts.vars[varName]
              break
            }
            // если переменной нет — фоллбэк к обычному доступу по ключу "$name"
          }
          cur = cur?.[k as any]
          break

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
          // По требованиям CRUD с одиночным wildcard не поддерживаем.
          // (Даже в get — чтобы поведение было консистентным.)
          throw new Error('get: wildcard "*" без параметров не поддерживается')
      }
    }

    return cur
  }

  set(
    path: DataPathDef,
    value: unknown,
    opts?: {
      vars?: Record<string, any>
    },
  ): void {
    const segs = DataPath.from(path, opts).segments()
    if (segs.length === 0) {
      this._root = value as DataObject
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
            // если дальше индекс/параметр — нужен массив, иначе объект
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
          if (!Array.isArray(cur)) {
            throw new Error('set: ожидался массив для индекса')
          }
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
          if (!Array.isArray(cur)) {
            throw new Error('set: параметризованный доступ ожидает массив')
          }
          let idx = this._findIndexByParam(cur, s.pkey!, s.pval!, opts)
          if (idx === -1) {
            if (!this._opts.autoCreate) {
              throw new Error(
                'set: элемент по [param=value] не найден (autoCreate=false)',
              )
            }
            const created: Record<string, unknown> = { [s.pkey!]: s.pval }
            idx = cur.push(created) - 1
          }
          cur = cur[idx]
          break
        }

        case SegKind.Wildcard:
          throw new Error('set: wildcard "*" без параметров не поддерживается')
      }
    }

    // лист
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
        if (!Array.isArray(cur)) {
          throw new Error('set: ожидался массив для индекса в листе')
        }
        const i = leaf.index as number
        ;(cur as any[])[i] = value
        break
      }

      case SegKind.Param: {
        if (!Array.isArray(cur)) {
          throw new Error('set: параметризованный лист ожидает массив')
        }
        if (!this._isPlainObject(value)) {
          throw new Error(
            'set: значение для [param=value] должно быть plain-object',
          )
        }

        let idx = this._findIndexByParam(cur, leaf.pkey!, leaf.pval!, opts)
        if (idx === -1) {
          if (!this._opts.autoCreate) {
            throw new Error(
              'set: элемент по [param=value] не найден (autoCreate=false)',
            )
          }
          const created: Record<string, unknown> = { [leaf.pkey!]: leaf.pval }
          idx = cur.push(created) - 1
        }
        const el = cur[idx]

        if (!this._isPlainObject(el)) {
          throw new Error(
            'set: целевой элемент по [param=value] не является объектом',
          )
        }

        // Сохраняем ссылочную стабильность: чистим и мёржим
        Object.keys(el).forEach((k) => delete (el as any)[k])
        Object.assign(el, value as object)
        break
      }

      case SegKind.Wildcard:
        throw new Error('set: wildcard "*" без параметров не поддерживается')
    }
  }

  delete(
    path: DataPathDef,
    opts?: {
      vars?: Record<string, any>
    },
  ): void {
    const segs = DataPath.from(path, opts).segments()

    if (segs.length === 0) {
      this._root = {}
      return
    }

    // Идём до родителя листа
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
        const i = leaf.index as number
        if (this._opts.arrayDelete === 'splice') {
          if (i >= 0 && i < cur.length) cur.splice(i, 1)
        } else {
          delete cur[i]
        }
        break
      }

      case SegKind.Param: {
        if (!Array.isArray(cur)) return
        const idx = this._findIndexByParam(cur, leaf.pkey!, leaf.pval!, opts)
        if (idx === -1) return
        if (this._opts.arrayDelete === 'splice') cur.splice(idx, 1)
        else delete cur[idx]
        break
      }

      case SegKind.Wildcard:
        throw new Error('delete: wildcard "*" без параметров не поддерживается')
    }
  }

  merge(
    path: DataPathDef,
    value: unknown,
    opts?: {
      vars?: Record<string, any>
    },
  ): void {
    const target = this.get(path, opts)
    if (this._isPlainObject(target) && this._isPlainObject(value)) {
      Object.assign(target as object, value as object)
      return
    }
    this.set(path, value)
  }

  private _findIndexByParam(
    arr: any[],
    pkey: string,
    pval: unknown,
    opts?: {
      vars?: Record<string, any>
    },
  ): number {
    if (typeof pval === 'string' && pval.startsWith('$')) {
      pval = this.get(pval, opts)
    }

    let ind = arr.findIndex((el) => {
      if (!this._isPlainObject(el)) return false
      return (el as any)[pkey] === pval
    })

    // Попытка вычислить выражение
    if (ind === -1) {
      pval = this.get(pval, opts)
      ind = arr.findIndex((el) => {
        if (!this._isPlainObject(el)) return false
        return (el as any)[pkey] === pval
      })
    }

    return ind
  }

  private _isPlainObject(x: unknown): x is Record<string, unknown> {
    return typeof x === 'object' && x !== null && !Array.isArray(x)
  }
}
