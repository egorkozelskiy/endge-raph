import type { Branded } from '@/domain/types/brand.types'
import type { DataPath } from '@/domain/entities/DataPath'
import type { RaphNode } from '@/domain/core/RaphNode'
import type { RaphNodeType } from '@/domain/types/base.types'

/**
 * Название фазы
 **/
export type PhaseName = Branded<string, 'PhaseName'>

/**
 * Способы для обхода графа нод
 */
export type Traversal =
  | 'dirty-only' // только отмеченные ноды
  | 'dirty-and-down' // каждая грязная + её потомки (top-down)
  | 'dirty-and-up' // грязная + подниматься к предкам (bottom-up)
  | 'all' // все ноды в графе, начиная с _root

//
export type PhaseEvent = {
  // исходный путь события
  path: DataPath

  // захваченные параметры (если были)
  params?: Record<string, unknown>
}

/**
 * Контекст выполнения фазы
 */
export type PhaseExecutorContext = {
  phase: PhaseName
  node: RaphNode
  events?: PhaseEvent[]
}

/**
 * Тип для функции, которая выполняет фазу
 */
export type PhaseExecutor = (ctx: PhaseExecutorContext) => void | Promise<void>

/**
 * Описание фазы RaphApp
 */
export type RaphPhase = {
  name: PhaseName
  traversal: Traversal
  executor: PhaseExecutor
  routes: string[]
  nodes?: (node: RaphNode) => boolean | RaphNodeType[]
}
