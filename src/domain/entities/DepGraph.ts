import type { RaphNode } from '@/domain/core/RaphNode'

/**
 * Ациклический граф зависимостей (DAG) для Raph.
 * Хранит:
 *  - nodes: id -> RaphNode
 *  - parents/children: id -> Set<ids>
 *  - depth: id -> number  (истина глубины внутри графа)
 *
 * Инварианты:
 *  - Нет единственного root; может быть много корней (узлы без родителей).
 *  - depth(v) = 0, если у v нет родителей; иначе 1 + max(depth(parent)).
 *  - Добавление ребра parent->child запрещено, если образуется цикл.
 */
export class DepGraph {
  private _nodes = new Map<string, RaphNode>()
  private _children = new Map<string, Set<string>>() // id -> Set(child ids)
  private _parents = new Map<string, Set<string>>() // id -> Set(parent ids)
  private _depth = new Map<string, number>() // id -> depth
  private _roots = new Set<string>() // кэш узлов без родителей

  //
  //
  addNode(node: RaphNode): void {
    const id = node.id
    if (this._nodes.has(id)) return
    this._nodes.set(id, node)
    this._children.set(id, new Set())
    this._parents.set(id, new Set())
    this._depth.set(id, 0)
    this._roots.add(id)
  }

  //
  //
  removeNode(nodeOrId: string | RaphNode): void {
    const id = typeof nodeOrId === 'string' ? nodeOrId : nodeOrId.id
    if (!this._nodes.has(id)) return

    // удалить ребро у всех родителей
    const parents = this._parents.get(id)!
    for (const p of parents) {
      this._children.get(p)!.delete(id)
    }

    // удалить ребро у всех детей и пересчитать их глубины
    const children = this._children.get(id)!
    for (const ch of children) {
      const ps = this._parents.get(ch)!
      ps.delete(id)
      if (ps.size === 0) this._roots.add(ch)
      this._recomputeDepthCascade(ch)
    }

    // очистить себя
    this._nodes.delete(id)
    this._parents.delete(id)
    this._children.delete(id)
    this._depth.delete(id)
    this._roots.delete(id)
  }

  hasNode(nodeOrId: string | RaphNode): boolean {
    const id = typeof nodeOrId === 'string' ? nodeOrId : nodeOrId.id
    return this._nodes.has(id)
  }

  getNode(id: string): RaphNode | undefined {
    return this._nodes.get(id)
  }

  size(): number {
    return this._nodes.size
  }

  addEdge(parent: string | RaphNode, child: string | RaphNode): boolean {
    const p = typeof parent === 'string' ? parent : parent.id
    const c = typeof child === 'string' ? child : child.id
    if (p === c) return false
    if (!this._nodes.has(p) || !this._nodes.has(c)) return false

    // цикл? проверяем достижимость p из c по children
    if (this._wouldCreateCycle(p, c)) {
      console.warn(`[DepGraph] Cycle detected: ${p} -> ${c} rejected`)
      return false
    }

    const ch = this._children.get(p)!
    if (!ch.has(c)) {
      ch.add(c)
      const ps = this._parents.get(c)!
      const wasRoot = ps.size === 0
      ps.add(p)
      if (wasRoot) this._roots.delete(c)
      this._recomputeDepthCascade(c)
    }
    return true
  }

  removeEdge(parent: string | RaphNode, child: string | RaphNode): void {
    const p = typeof parent === 'string' ? parent : parent.id
    const c = typeof child === 'string' ? child : child.id
    const ch = this._children.get(p)
    if (ch && ch.delete(c)) {
      const ps = this._parents.get(c)!
      ps.delete(p)
      if (ps.size === 0) this._roots.add(c)
      this._recomputeDepthCascade(c)
    }
  }

  parentsOf(nodeOrId: string | RaphNode): ReadonlySet<RaphNode> {
    const id = typeof nodeOrId === 'string' ? nodeOrId : nodeOrId.id
    const out = new Set<RaphNode>()
    for (const pid of this._parents.get(id) ?? EMPTY_SET_STR) {
      const n = this._nodes.get(pid)
      if (n) out.add(n)
    }
    return out
  }

  childrenOf(nodeOrId: string | RaphNode): ReadonlySet<RaphNode> {
    const id = typeof nodeOrId === 'string' ? nodeOrId : nodeOrId.id
    const out = new Set<RaphNode>()
    for (const cid of this._children.get(id) ?? EMPTY_SET_STR) {
      const n = this._nodes.get(cid)
      if (n) out.add(n)
    }
    return out
  }

  rootIds(): ReadonlySet<string> {
    return this._roots
  }

  roots(): ReadonlySet<RaphNode> {
    const out = new Set<RaphNode>()
    for (const id of this._roots) {
      const n = this._nodes.get(id)
      if (n) out.add(n)
    }
    return out
  }

  getDepth(nodeOrId: string | RaphNode): number {
    const id = typeof nodeOrId === 'string' ? nodeOrId : nodeOrId.id
    return this._depth.get(id) ?? 0
  }

  /**
   * Полный топологический порядок всего графа (Kahn).
   * (Можно использовать для отладки; в рантайме обычно хватает depth.)
   */
  topoOrder(): RaphNode[] {
    // локальная копия степеней внутри всего графа
    const indeg = new Map<string, number>()
    for (const id of this._nodes.keys())
      indeg.set(id, this._parents.get(id)!.size)

    // очередь вершин с inDeg=0, упорядочим по depth/weight при желании вне
    const q: string[] = []
    for (const [id, d] of indeg) if (d === 0) q.push(id)

    const out: RaphNode[] = []
    while (q.length) {
      const id = q.shift()!
      const n = this._nodes.get(id)
      if (n) out.push(n)
      for (const ch of this._children.get(id) ?? EMPTY_SET_STR) {
        const d = (indeg.get(ch) || 0) - 1
        indeg.set(ch, d)
        if (d === 0) q.push(ch)
      }
    }

    if (out.length !== this._nodes.size) {
      throw new Error('[DepGraph] Cycle detected in topoOrder()')
    }
    return out
  }

  /**
   * Расширение множества по стратегии обхода.
   * 'all' — вернуть все ноды графа (т.к. корня нет).
   */
  expandByTraversal(
    base: Set<RaphNode> | null,
    traversal: 'dirty-only' | 'dirty-and-down' | 'dirty-and-up' | 'all',
  ): Set<RaphNode> {
    const out = new Set<RaphNode>()

    if (traversal === 'all') {
      for (const n of this._nodes.values()) out.add(n)
      return out
    }

    if (traversal === 'dirty-only') {
      for (const n of base) if (this._nodes.has(n.id)) out.add(n)
      return out
    }

    if (traversal === 'dirty-and-down') {
      const queue: string[] = []
      for (const n of base) {
        if (!this._nodes.has(n.id)) continue
        if (!out.has(n)) out.add(n)
        queue.push(n.id)
      }
      while (queue.length) {
        const id = queue.shift()!
        for (const cid of this._children.get(id) ?? EMPTY_SET_STR) {
          const node = this._nodes.get(cid)
          if (node && !out.has(node)) {
            out.add(node)
            queue.push(cid)
          }
        }
      }
      return out
    }

    if (traversal === 'dirty-and-up') {
      const queue: string[] = []
      for (const n of base) {
        if (!this._nodes.has(n.id)) continue
        if (!out.has(n)) out.add(n)
        queue.push(n.id)
      }
      while (queue.length) {
        const id = queue.shift()!
        for (const pid of this._parents.get(id) ?? EMPTY_SET_STR) {
          const node = this._nodes.get(pid)
          if (node && !out.has(node)) {
            out.add(node)
            queue.push(pid)
          }
        }
      }
      return out
    }

    return out
  }

  /**
   * Проверка цикла: существует ли путь child => ... => parent (по children-ребрам)
   */
  private _wouldCreateCycle(parentId: string, childId: string): boolean {
    if (parentId === childId) return true
    const seen = new Set<string>()
    const q: string[] = [childId]
    while (q.length) {
      const id = q.pop()!
      if (!seen.add(id)) continue
      if (id === parentId) return true
      const ch = this._children.get(id)
      if (ch) for (const next of ch) q.push(next)
    }
    return false
  }

  /**
   * Инкрементальный пересчет глубины для id и каскад вниз по потомкам.
   */
  private _recomputeDepthCascade(startId: string): void {
    const newDepth = this._calcDepth(startId)
    if (newDepth === this._depth.get(startId)) return
    this._depth.set(startId, newDepth)

    const q: string[] = []
    for (const ch of this._children.get(startId) ?? EMPTY_SET_STR) q.push(ch)

    while (q.length) {
      const id = q.pop()!
      const nd = this._calcDepth(id)
      if (nd !== this._depth.get(id)) {
        this._depth.set(id, nd)
        for (const ch of this._children.get(id) ?? EMPTY_SET_STR) q.push(ch)
      }
    }
  }

  /**
   * depth(v) = 0 если нет родителей, иначе 1 + max(depth(parent))
   */
  private _calcDepth(id: string): number {
    const ps = this._parents.get(id)
    if (!ps || ps.size === 0) return 0
    let maxd = 0
    for (const p of ps) {
      const d = this._depth.get(p) ?? 0
      if (d + 1 > maxd) maxd = d + 1
    }
    return maxd
  }
}

const EMPTY_SET_STR: ReadonlySet<string> = new Set()
