import { RaphApp } from '@/domain/core/RaphApp'
import type { RaphNode } from '@/domain/core/RaphNode'
import type {
  DataObject,
  DataPathDef,
  RaphOptions,
  Undefinable,
} from '@/domain/types/base.types'
import type {
  PhaseExecutorContext,
  PhaseName,
  RaphPhase,
} from '@/domain/types/phase.types'
import { RaphSignal } from '@/domain/reactivity/RaphSignal'
import { RaphEffect } from '@/domain/reactivity/RaphEffect'
import { RaphWatch } from '@/domain/reactivity/RaphWatch'
import { DataPath } from '@/domain/entities/DataPath'
import type { WatchCallback } from '@/domain/types/reactive.types'

export class Raph {
  //
  // Core данные
  //
  private static _app = new RaphApp()
  private static _contextStack: RaphNode[] = []

  //
  // Системные генераторы
  //
  private static __signalId = 0
  private static __effectId = 0
  private static __watchId = 0

  //
  // Инициализация
  //
  static {
    this.definePhases([])
  }

  //
  // PUBLIC API
  //

  static options(opts: Partial<RaphOptions>): void {
    this.app.options(opts)
  }

  static definePhases(phases: RaphPhase[]): void {
    this.app.definePhases([
      //
      // Фаза обработки computed значений
      //
      {
        name: '__computed' as PhaseName,
        traversal: 'dirty-and-down',
        routes: ['__signals.*'],
        nodes: (node: RaphNode) => node instanceof RaphSignal,
        executor: (ctx: PhaseExecutorContext) => {
          (ctx.node as RaphSignal<any>).update()
        },
      },
      //
      // Фаза обработки эффектов
      //
      {
        name: '__effects' as PhaseName,
        traversal: 'dirty-only',
        routes: ['__signals.*'],
        nodes: (node: RaphNode) => node instanceof RaphEffect,
        executor: (ctx: PhaseExecutorContext) => {
          (ctx.node as RaphEffect).run()
        },
      },
      //
      // Фаза обработки watch
      //
      {
        name: '__watch' as PhaseName,
        traversal: 'dirty-only',
        routes: ['*'],
        nodes: (node: RaphNode) => node instanceof RaphWatch,
        executor: (ctx: PhaseExecutorContext) => {
          (ctx.node as RaphWatch).run(ctx)
        },
      },
      //
      // Пользовательские фазы
      //
      ...phases,
    ])
  }

  static signal<T>(input: T | (() => T)): RaphSignal<T> {
    const id = `__signals.${this.__signalId++}`

    // если у тебя DataPath.fromString — оставь этот вызов;
    // если обычно используешь DataPath.from, замени на него.
    const path = DataPath.fromString(id)

    const compute = typeof input === 'function' ? (input as () => T) : undefined

    // RaphSignal сам делает app.addNode(this) и (для computed) первый update()
    const sig = new RaphSignal<T>(this._app, id, path, compute)

    if (!compute) {
      // задать стартовое значение без notify/dirty
      this._app.dataAdapter.set(path, input as unknown)
    }

    return sig
  }

  static effect(
    fn: () => void | (() => void),
    opts?: { weight?: number; immediate?: boolean },
  ): () => void {
    const id = `__effects.${this.__effectId++}`
    const eff = new RaphEffect(this._app, fn, {
      id,
      weight: opts?.weight,
      immediate: opts?.immediate ?? true,
    })

    // Если immediate=false — добавим в очередь выбранной фазы,
    // чтобы эффект выполнился там и захватил зависимости.
    if (opts?.immediate === false) {
      this._app.dirty('__effects' as PhaseName, eff)
    }

    // Вернём disposer
    return () => eff.stop()
  }

  /**
   * Подписка на один или несколько путей/масок.
   * Колбэк получает батч событий текущего тика.
   * Возвращает disposer.
   */
  static watch(
    maskOrMasks: DataPathDef | DataPathDef[],
    cb: WatchCallback,
    opts?: { weight?: number },
  ): () => void {
    const masks = Array.isArray(maskOrMasks) ? maskOrMasks : [maskOrMasks]
    const id = `__watch.${this.__watchId++}`
    const node = new RaphWatch(this._app, id, masks, cb, opts?.weight ?? 0)

    return () => node.remove()
  }

  /**
   * Получить значение по пути.
   */
  static get(
    path: DataPathDef,
    opts?: {
      vars?: object
    },
  ): Undefinable<unknown> {
    return this.app.get(path, opts)
  }

  /**
   * Установить значение по пути.
   */
  static set(
    path: DataPathDef,
    value: unknown,
    opts?: { invalidate?: boolean; vars?: Record<string, any> },
  ): void {
    this.app.set(path, value, opts)
  }

  /**
   * Слияние значение по пути.
   */
  static merge(
    path: DataPathDef,
    value: unknown,
    opts?: { invalidate?: boolean; vars?: Record<string, any> },
  ): void {
    this.app.merge(path, value, opts)
  }

  /**
   * Удалить значение по пути.
   */
  static delete(
    path: DataPathDef,
    opts?: { invalidate?: boolean; vars?: Record<string, any> },
  ): void {
    this.app.delete(path, opts)
  }

  //
  // PRIVATE (STACK)
  //

  static get currentNode(): RaphNode | undefined {
    return this._contextStack[this._contextStack.length - 1]
  }

  static pushContext(node: RaphNode): void {
    this._contextStack.push(node)
  }

  static popContext(): void {
    this._contextStack.pop()
  }

  //
  // ACCESS
  //

  static get app(): RaphApp {
    return Raph._app
  }

  static get data(): DataObject {
    return Raph.app.data
  }
}
