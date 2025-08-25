//
import { RaphNode } from '@/domain/core/RaphNode'
import type {
  EffectCleanup,
  RaphEffectOptions,
} from '@/domain/types/reactive.types'
import type { RaphApp } from '@/domain/core/RaphApp'
import { Raph } from '@/domain/core/Raph'

export class RaphEffect extends RaphNode {
  private readonly _fn: () => EffectCleanup
  private _cleanup?: () => void
  private _stopped = false

  constructor(app: RaphApp, fn: () => EffectCleanup, opts: RaphEffectOptions) {
    super(app, { id: opts.id, weight: opts.weight ?? 0, type: 'effect' })
    this._fn = fn

    // Регистрируем в графе
    this.app.addNode(this)

    // Первая инициализация: либо сразу, либо через фазу
    if (opts.immediate ?? true) {
      this.run() // выполнит fn под контекстом и подпишется на прочитанные пути
    }
  }

  /**
   * Выполнить эффект, пересобрав зависимости.
   */
  run(): void {
    if (this._stopped) return

    // Снимаем прошлые подписки на пути
    this.app.untrack(this)

    // Вызываем cleanup прошлого запуска
    if (this._cleanup) {
      try {
        this._cleanup()
      } catch {
        // ToDo: ignore?
      }
      this._cleanup = undefined
    }

    // Выполняем под контекстом — все чтения сигналов/данных подпишут эффект
    Raph.pushContext(this)
    let ret: EffectCleanup
    try {
      ret = this._fn()
    } finally {
      Raph.popContext()
    }

    // Сохраняем cleanup, если вернули функцию
    if (typeof ret === 'function') this._cleanup = ret
  }

  /**
   * Остановить эффект: снять подписки, вызвать cleanup и удалить из графа.
   */
  stop(): void {
    if (this._stopped) return
    this._stopped = true
    try {
      this._cleanup?.()
    } catch {
      // ToDo: ignore?
    }
    this._cleanup = undefined
    this.app.untrack(this)
    this.app.removeNode(this)
  }
}
