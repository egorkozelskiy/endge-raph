import { RaphNode } from '@/domain/core/RaphNode'
import type { DataPath } from '@/domain/entities/DataPath'
import type { RaphApp } from '@/domain/core/RaphApp'
import { Raph } from '@/domain/core/Raph'

export class RaphSignal<T> extends RaphNode {
  readonly path: DataPath
  readonly compute?: () => T

  /**
   * Текущий набор зависимостей (источников) для computed
   */
  private _deps = new Set<RaphNode>()

  //
  //
  constructor(app: RaphApp, id: string, path: DataPath, compute?: () => T) {
    super(app, { id, weight: 0, type: 'signal' })
    this.path = path
    this.compute = compute

    // регистрируем ноду в графе
    this.app.addNode(this)
    this.app.track(this, this.path)

    // для computed — сразу первичный расчёт, без уведомлений наружу
    if (this.compute) {
      this.update()
    }
  }

  /**
   * Прочтение значения (и возможная фиксация зависимости контекстной ноды от этого сигнала)
   */
  get value(): T {
    const current = Raph.currentNode
    if (current) {
      if (current instanceof RaphSignal) {
        // вычисляется другой сигнал — строим ребро dep-this и подписку по пути
        current.addDependency(this)
      } else {
        // любая другая нода: достаточно подписки по пути
        this.app.track(current, this.path)
      }
    }
    return this.app.get(this.path) as T
  }

  /**
   * Запись значения (только для обычных сигналов)
   */
  set value(next: T) {
    if (this.compute) {
      throw new Error('Cannot assign to a computed signal.')
    }

    // обычный сигнал: запись + notify
    this.app.set(this.path, next)
  }

  /**
   * Пересчёт computed-сигнала. Без notify.
   */
  update(): void {
    if (!this.compute) return

    // Снимаем старые зависимости (и из графа, и из роутера путей)
    if (this._deps.size) {
      for (const dep of this._deps) {
        this.app.removeDependency(dep, this)
        const depPath = (dep as any).path
        if (depPath) this.app.untrack(this, depPath)
      }
      this._deps.clear()
    }

    // Выполняем вычисление под контекстом
    Raph.pushContext(this)
    let val: T
    try {
      val = this.compute()
    } finally {
      Raph.popContext()
    }

    // Помещаем новое значение напрямую в хранилище (без лишних инвалидаций)
    this.app.dataAdapter.set(this.path, val as unknown)
  }

  /**
   * Зарегистрировать зависимость this от dep (dep - this)
   */
  addDependency(dep: RaphNode): void {
    if (dep === this || this._deps.has(dep)) return
    this._deps.add(dep)

    // граф: ребро dep - this
    this.app.addDependency(dep, this)

    // роутер путей: чтобы notify по dep.path находил this как грязную
    const depPath = (dep as any).path
    if (depPath) this.app.track(this, depPath)
  }
}
