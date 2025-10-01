import type { RaphNode } from '@/domain/core/RaphNode'
import type {
  PhaseEvent,
  PhaseName,
  RaphPhase,
} from '@/domain/types/phase.types'
import type { DepGraph } from '@/domain/entities/DepGraph'

export interface RaphEventPayloads {
  //
  'node:tracked': { node: RaphNode; path: string }
  'node:notified': { node: RaphNode; event: PhaseEvent }

  //
  'nodes:changed': { graph: DepGraph }
  'nodes:notified': {
    ctxs: Array<{
      phase: PhaseName
      node: RaphNode
      events?: PhaseEvent[]
    }>
  }

  //
  'phases:reinit': { phases: RaphPhase[] }

  //
  'debug:nodes': {}
  'debug:metrics': {}
}
