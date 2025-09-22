import type { RaphApp } from '@/domain/core/RaphApp'

export class RaphNode {
  //
  // Системные
  //

  //
  private _id: string

  // тип узла, по умолчанию 'default'
  private _type: string = 'default'

  //
  private _app: RaphApp

  // пользовательское значение приоритета обработки (на одном уровне)
  private _weight: number = 0

  // пользовательское значение приоритета обработки (на одном уровне)
  private _meta: Record<string, unknown> = {}

  // Битовая маска с информацией, для какой фазы узел требует обработки
  private __dirtyPhasesMask: number = 0

  //
  private static __nodeCounter = 0

  //
  //
  constructor(
    app: RaphApp,
    opts?: {
      id?: string
      weight?: number
      meta?: Record<string, unknown>
      type?: string
    },
  ) {
    this._app = app

    this._id = `node-${RaphNode.__nodeCounter++}`
    if (opts?.id) {
      this._id = opts.id
    }
    if (opts?.weight) {
      this._weight = opts.weight
    }
    if (opts?.meta) {
      this._meta = opts.meta
    }
    if (opts?.type) {
      this._type = opts.type
    }
  }

  //
  // PUBLIC API
  //

  /**
   * Очищает ноду и все ее потомки
   */
  addChild(node: RaphNode): void {
    this._app.addNode(node)
    this._app.addDependency(this, node)
  }

  /**
   * Очищает ноду и все ее потомки
   */
  remove(): void {
    this._app.removeNode(this)
    this._weight = 0
  }

  addMeta(key: string, value: unknown): void {
    this._meta[key] = value
  }

  //
  // ACCESS
  //

  get app(): RaphApp {
    return this._app
  }

  get id(): string {
    return this._id
  }

  get weight(): number {
    return this._weight
  }

  get meta(): Record<string, unknown> {
    return this._meta
  }

  get type(): string {
    return this._type
  }
}
