//
import type { PhaseEvent } from '@/domain/types/phase.types'

export type EffectCleanup = void | (() => void)

//
export interface RaphEffectOptions {
  //
  id: string

  //
  weight?: number

  // Выполнить эффект сразу (захватить зависимости)
  immediate?: boolean
}

//
export type WatchCallback = (payload: { events: PhaseEvent[] }) => void
