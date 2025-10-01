import type { RaphNode } from '@/domain/core/RaphNode'
import { Raph } from '@/domain/core/Raph'

type EventOff = () => void

type NodeInfo = {
  id: string
  type?: string
  routes: Set<string>
  parents: Set<string>
  children: Set<string>
}

export type NodeTree = {
  id: string
  type?: string
  children: NodeTree[]
  routes: string[]
}

export type NodeFlatDump = {
  id: string
  type?: string
  parentIds: string[]
  childIds: string[]
  routes: string[]
}

type Metrics = {
  eventsPerSec: number
}

export class RaphDebug {
  private enabled = false
  private off: EventOff[] = []

  // id -> агрегированная инфа (подписки + связи)
  private nodes = new Map<string, NodeInfo>()

  /** Вкл/выкл отладчик (подписки/отписки на события) */
  enable(value: boolean): void {
    if (value === this.enabled) return
    if (value) this.attach()
    else this.detach()
  }

  /** Жёсткая очистка состояния (не трогает флаги enable/disable) */
  clear(): void {
    this.nodes.clear()
    this.notifyHits.length = 0
    this.eventHits.length = 0
  }

  /** Явный рефреш графовой иерархии (без сброса подписок) */
  refresh(): void {
    this.rebuildHierarchyFromGraph()
  }

  /** Плоский дамп для таблицы/списка */
  getFlat(): NodeFlatDump[] {
    const out: NodeFlatDump[] = []
    for (const [id, info] of this.nodes) {
      out.push({
        id,
        type: info.type,
        parentIds: [...info.parents].sort(),
        childIds: [...info.children].sort(),
        routes: [...info.routes].sort(),
      })
    }
    out.sort((a, b) => a.id.localeCompare(b.id))
    return out
  }

  /** Дерево для UI: у узла — дети и далее его подписки */
  getTree(): NodeTree[] {
    const roots = Array.from(Raph.app.graph.roots())
    const seen = new Set<string>()

    const build = (n: RaphNode): NodeTree => {
      const info = this.ensureInfo(n)
      const kids = Array.from(Raph.app.graph.childrenOf(n))
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((ch) => build(ch))
      seen.add(n.id)
      return {
        id: n.id,
        type: n.type,
        children: kids,
        routes: [...info.routes].sort(),
      }
    }

    const forest = Array.from(roots)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((r) => build(r))

    for (const id of this.nodes.keys()) {
      if (seen.has(id)) continue
      const n = Raph.app.getNode(id)
      if (n) forest.push(build(n))
    }

    return forest
  }

  /** Текущие метрики (на момент вызова) */
  getMetrics(): Metrics {
    return this._computeMetrics(this._now())
  }

  // ================== INTERNAL ==================

  private attach(): void {
    this.enabled = true

    // 1) Иерархия графа изменилась
    this.off.push(
      Raph.events.on('nodes:changed', () => {
        this.rebuildHierarchyFromGraph()
        Raph.events.emit('debug:nodes', {})
      }),
    )

    // 2) Узел подписался на маску
    this.off.push(
      Raph.events.on('node:tracked', (p: { node: RaphNode; path: string }) => {
        const info = this.ensureInfo(p.node)
        if (typeof p.path === 'string' && p.path) info.routes.add(p.path)
        Raph.events.emit('debug:nodes', {})
      }),
    )

    // 3) При каждом батче уведомлений считаем метрику и пушим в bus
    this.off.push(
      Raph.events.on(
        'nodes:notified',
        (p: {
          ctxs: Array<{ phase: string; node: RaphNode; events?: any[] }>
        }) => {
          Raph.events.emit('debug:metrics', {
            ups: Raph.app.ups,
            eps: Raph.app.eps,
            nps: Raph.app.nps,
          })
        },
      ),
    )

    // первичный прогон
    this.rebuildHierarchyFromGraph()
  }

  private detach(): void {
    this.enabled = false
    for (const f of this.off) {
      try {
        f()
      } catch {}
    }
    this.off = []
  }

  private ensureInfo(node: RaphNode): NodeInfo {
    const id = node.id
    let info = this.nodes.get(id)
    if (!info) {
      info = {
        id,
        type: node.type,
        routes: new Set<string>(),
        parents: new Set<string>(),
        children: new Set<string>(),
      }
      this.nodes.set(id, info)
    } else if (!info.type && node.type) {
      info.type = node.type
    }
    return info
  }

  /** Пересборка только parent/child из графа; подписки не трогаем. */
  private rebuildHierarchyFromGraph(): void {
    for (const info of this.nodes.values()) {
      info.parents.clear()
      info.children.clear()
    }

    const seen = new Set<string>()
    const dfs = (n: RaphNode) => {
      if (!seen.add(n.id)) return
      const cur = this.ensureInfo(n)
      for (const ch of Raph.app.graph.childrenOf(n)) {
        const child = this.ensureInfo(ch)
        cur.children.add(ch.id)
        child.parents.add(n.id)
        dfs(ch)
      }
    }

    for (const r of Raph.app.graph.roots()) dfs(r)
    for (const [id] of this.nodes) {
      if (seen.has(id)) continue
      const n = Raph.app.getNode(id)
      if (n) dfs(n)
    }

    for (const [id, info] of Array.from(this.nodes.entries())) {
      if (Raph.app.getNode(id)) continue
      if (info.routes.size === 0) this.nodes.delete(id)
    }
  }
}
