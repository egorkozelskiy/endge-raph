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

// Формат записи resolved
export type ResolvedEntry = {
  segment: string // имя контейнера, например "attrs" или "legs"
  keyField: string // pk/fk имя, например "legId"
  keyValue: unknown // исходное значение pval (строка с $ тоже норм), полезно для отладки
  index: number // индекс найденного элемента массива, -1 если не нашли
}

//
export type PhaseEvent = {
  // исходный путь события
  original: string
  canonical: string
  canonicalDataPath: DataPath

  resolved: ResolvedEntry[]

  // захваченные параметры (если были)
  // params?: Record<string, unknown>
}

/**
 * Контекст выполнения фазы (для каждой ноды или для всех сразу)
 */
export type PhaseExecutorContext = {
  phase: PhaseName
  node: RaphNode
  events?: PhaseEvent[]
}

/**
 * Тип для функции, которая выполняет фазу
 */
export type PhaseEachExecutor = (
  ctx: PhaseExecutorContext,
) => void | Promise<void>

export type PhaseAllExecutor = (
  ctxs: PhaseExecutorContext[],
) => void | Promise<void>

/**
 * Описание фазы RaphApp
 */
export type RaphPhase = {
  name: PhaseName
  traversal: Traversal
  routes: string[]
} & ({ each: PhaseEachExecutor } | { all: PhaseAllExecutor }) &
  (
    | { nodes?: (node: RaphNode) => boolean }
    | { nodes?: (node: RaphNode) => RaphNodeType[] }
  )
