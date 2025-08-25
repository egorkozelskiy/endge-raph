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
    _nodes = new Map();
    _children = new Map(); // id -> Set(child ids)
    _parents = new Map(); // id -> Set(parent ids)
    _depth = new Map(); // id -> depth
    _roots = new Set(); // кэш узлов без родителей
    //
    //
    addNode(node) {
        const id = node.id;
        if (this._nodes.has(id))
            return;
        this._nodes.set(id, node);
        this._children.set(id, new Set());
        this._parents.set(id, new Set());
        this._depth.set(id, 0);
        this._roots.add(id);
    }
    //
    //
    removeNode(nodeOrId) {
        const id = typeof nodeOrId === 'string' ? nodeOrId : nodeOrId.id;
        if (!this._nodes.has(id))
            return;
        // удалить ребро у всех родителей
        const parents = this._parents.get(id);
        for (const p of parents) {
            this._children.get(p).delete(id);
        }
        // удалить ребро у всех детей и пересчитать их глубины
        const children = this._children.get(id);
        for (const ch of children) {
            const ps = this._parents.get(ch);
            ps.delete(id);
            if (ps.size === 0)
                this._roots.add(ch);
            this._recomputeDepthCascade(ch);
        }
        // очистить себя
        this._nodes.delete(id);
        this._parents.delete(id);
        this._children.delete(id);
        this._depth.delete(id);
        this._roots.delete(id);
    }
    hasNode(nodeOrId) {
        const id = typeof nodeOrId === 'string' ? nodeOrId : nodeOrId.id;
        return this._nodes.has(id);
    }
    getNode(id) {
        return this._nodes.get(id);
    }
    size() {
        return this._nodes.size;
    }
    addEdge(parent, child) {
        const p = typeof parent === 'string' ? parent : parent.id;
        const c = typeof child === 'string' ? child : child.id;
        if (p === c)
            return false;
        if (!this._nodes.has(p) || !this._nodes.has(c))
            return false;
        // цикл? проверяем достижимость p из c по children
        if (this._wouldCreateCycle(p, c)) {
            console.warn(`[DepGraph] Cycle detected: ${p} -> ${c} rejected`);
            return false;
        }
        const ch = this._children.get(p);
        if (!ch.has(c)) {
            ch.add(c);
            const ps = this._parents.get(c);
            const wasRoot = ps.size === 0;
            ps.add(p);
            if (wasRoot)
                this._roots.delete(c);
            this._recomputeDepthCascade(c);
        }
        return true;
    }
    removeEdge(parent, child) {
        const p = typeof parent === 'string' ? parent : parent.id;
        const c = typeof child === 'string' ? child : child.id;
        const ch = this._children.get(p);
        if (ch && ch.delete(c)) {
            const ps = this._parents.get(c);
            ps.delete(p);
            if (ps.size === 0)
                this._roots.add(c);
            this._recomputeDepthCascade(c);
        }
    }
    parentsOf(nodeOrId) {
        const id = typeof nodeOrId === 'string' ? nodeOrId : nodeOrId.id;
        const out = new Set();
        for (const pid of this._parents.get(id) ?? EMPTY_SET_STR) {
            const n = this._nodes.get(pid);
            if (n)
                out.add(n);
        }
        return out;
    }
    childrenOf(nodeOrId) {
        const id = typeof nodeOrId === 'string' ? nodeOrId : nodeOrId.id;
        const out = new Set();
        for (const cid of this._children.get(id) ?? EMPTY_SET_STR) {
            const n = this._nodes.get(cid);
            if (n)
                out.add(n);
        }
        return out;
    }
    rootIds() {
        return this._roots;
    }
    roots() {
        const out = new Set();
        for (const id of this._roots) {
            const n = this._nodes.get(id);
            if (n)
                out.add(n);
        }
        return out;
    }
    getDepth(nodeOrId) {
        const id = typeof nodeOrId === 'string' ? nodeOrId : nodeOrId.id;
        return this._depth.get(id) ?? 0;
    }
    /**
     * Полный топологический порядок всего графа (Kahn).
     * (Можно использовать для отладки; в рантайме обычно хватает depth.)
     */
    topoOrder() {
        // локальная копия степеней внутри всего графа
        const indeg = new Map();
        for (const id of this._nodes.keys())
            indeg.set(id, this._parents.get(id).size);
        // очередь вершин с inDeg=0, упорядочим по depth/weight при желании вне
        const q = [];
        for (const [id, d] of indeg)
            if (d === 0)
                q.push(id);
        const out = [];
        while (q.length) {
            const id = q.shift();
            const n = this._nodes.get(id);
            if (n)
                out.push(n);
            for (const ch of this._children.get(id) ?? EMPTY_SET_STR) {
                const d = (indeg.get(ch) || 0) - 1;
                indeg.set(ch, d);
                if (d === 0)
                    q.push(ch);
            }
        }
        if (out.length !== this._nodes.size) {
            throw new Error('[DepGraph] Cycle detected in topoOrder()');
        }
        return out;
    }
    /**
     * Расширение множества по стратегии обхода.
     * 'all' — вернуть все ноды графа (т.к. корня нет).
     */
    expandByTraversal(base, traversal) {
        const out = new Set();
        if (traversal === 'all') {
            for (const n of this._nodes.values())
                out.add(n);
            return out;
        }
        if (traversal === 'dirty-only') {
            for (const n of base)
                if (this._nodes.has(n.id))
                    out.add(n);
            return out;
        }
        if (traversal === 'dirty-and-down') {
            const queue = [];
            for (const n of base) {
                if (!this._nodes.has(n.id))
                    continue;
                if (!out.has(n))
                    out.add(n);
                queue.push(n.id);
            }
            while (queue.length) {
                const id = queue.shift();
                for (const cid of this._children.get(id) ?? EMPTY_SET_STR) {
                    const node = this._nodes.get(cid);
                    if (node && !out.has(node)) {
                        out.add(node);
                        queue.push(cid);
                    }
                }
            }
            return out;
        }
        if (traversal === 'dirty-and-up') {
            const queue = [];
            for (const n of base) {
                if (!this._nodes.has(n.id))
                    continue;
                if (!out.has(n))
                    out.add(n);
                queue.push(n.id);
            }
            while (queue.length) {
                const id = queue.shift();
                for (const pid of this._parents.get(id) ?? EMPTY_SET_STR) {
                    const node = this._nodes.get(pid);
                    if (node && !out.has(node)) {
                        out.add(node);
                        queue.push(pid);
                    }
                }
            }
            return out;
        }
        return out;
    }
    /**
     * Проверка цикла: существует ли путь child => ... => parent (по children-ребрам)
     */
    _wouldCreateCycle(parentId, childId) {
        if (parentId === childId)
            return true;
        const seen = new Set();
        const q = [childId];
        while (q.length) {
            const id = q.pop();
            if (!seen.add(id))
                continue;
            if (id === parentId)
                return true;
            const ch = this._children.get(id);
            if (ch)
                for (const next of ch)
                    q.push(next);
        }
        return false;
    }
    /**
     * Инкрементальный пересчет глубины для id и каскад вниз по потомкам.
     */
    _recomputeDepthCascade(startId) {
        const newDepth = this._calcDepth(startId);
        if (newDepth === this._depth.get(startId))
            return;
        this._depth.set(startId, newDepth);
        const q = [];
        for (const ch of this._children.get(startId) ?? EMPTY_SET_STR)
            q.push(ch);
        while (q.length) {
            const id = q.pop();
            const nd = this._calcDepth(id);
            if (nd !== this._depth.get(id)) {
                this._depth.set(id, nd);
                for (const ch of this._children.get(id) ?? EMPTY_SET_STR)
                    q.push(ch);
            }
        }
    }
    /**
     * depth(v) = 0 если нет родителей, иначе 1 + max(depth(parent))
     */
    _calcDepth(id) {
        const ps = this._parents.get(id);
        if (!ps || ps.size === 0)
            return 0;
        let maxd = 0;
        for (const p of ps) {
            const d = this._depth.get(p) ?? 0;
            if (d + 1 > maxd)
                maxd = d + 1;
        }
        return maxd;
    }
}
const EMPTY_SET_STR = new Set();
//# sourceMappingURL=DepGraph.js.map