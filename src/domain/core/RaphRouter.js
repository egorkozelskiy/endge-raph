import { DataPath } from '@/domain/entities/DataPath';
import { RouterNode } from '@/domain/core/RaphRouterNode';
import { SegKind } from '@/domain/types/path.types';
import { keyIndex, keyLiteralStr, keyParam } from '@/utils/path';
export class RaphRouter {
    _root = new RouterNode();
    // --- Versioning for caches ---
    _version = 0;
    // --- Caches ---
    _segCache = new Map();
    _matchCache = new Map();
    _prefixCache = new Map(); // cache for collectByPrefix
    static MAX_SEG_CACHE = 20_000;
    static MAX_MATCH_CACHE = 50_000;
    static MAX_PREFIX_CACHE = 50_000;
    // -------------------------
    // Helpers: caches / keys
    // -------------------------
    _toKey(dp) {
        if (typeof dp === 'string')
            return dp;
        return DataPath.from(dp).toStringPath();
    }
    _getSegs(input) {
        const key = this._toKey(input);
        const hit = this._segCache.get(key);
        if (hit)
            return hit;
        const segs = DataPath.from(key).segments();
        if (this._segCache.size > RaphRouter.MAX_SEG_CACHE)
            this._segCache.clear();
        this._segCache.set(key, segs);
        return segs;
    }
    _cacheMatchRead(pathKey) {
        const c = this._matchCache.get(pathKey);
        if (!c || c.v !== this._version)
            return null;
        return c.res;
    }
    _cacheMatchWrite(pathKey, res) {
        if (this._matchCache.size > RaphRouter.MAX_MATCH_CACHE)
            this._matchCache.clear();
        this._matchCache.set(pathKey, { v: this._version, res });
    }
    _cachePrefixRead(pathKey) {
        const c = this._prefixCache.get(pathKey);
        if (!c || c.v !== this._version)
            return null;
        return c.res;
    }
    _cachePrefixWrite(pathKey, res) {
        if (this._prefixCache.size > RaphRouter.MAX_PREFIX_CACHE)
            this._prefixCache.clear();
        this._prefixCache.set(pathKey, { v: this._version, res });
    }
    _bumpVersion() {
        this._version++;
        // ленивая инвалидция: записи с другой версией считаются просроченными
        if (this._version % 1024 === 0) {
            this._matchCache.clear();
            this._prefixCache.clear();
        }
    }
    // -------------------------
    // Public API
    // -------------------------
    /** Зарегистрировать маршрут (маску) с полезной нагрузкой */
    add(mask, payload) {
        const segs = this._getSegs(mask);
        let node = this._root;
        for (let i = 0; i < segs.length; i++) {
            const s = segs[i];
            const last = i === segs.length - 1;
            if (s.kind === SegKind.Wildcard && last) {
                // глубокий wildcard — привязываем payload к текущему узлу
                node.pushDeep(payload);
                this._bumpVersion();
                return;
            }
            switch (s.kind) {
                case SegKind.Key:
                    node = node.addExact(keyLiteralStr(s.key));
                    break;
                case SegKind.Index:
                    node = node.addExact(keyIndex(s.index));
                    break;
                case SegKind.Wildcard:
                    node = node.addWildcard();
                    break;
                case SegKind.Param:
                    // если s.pval - строка и начинается с '$' => placeholder (маска захвата)
                    if (typeof s.pval === 'string' && s.pval.startsWith('$')) {
                        // varName — без '$' или с '$' — как вам удобнее; я сохраню без $
                        const varName = s.pval.slice(1);
                        node = node.addParamAny(s.pkey, varName);
                    }
                    else {
                        node = node.addParam(s.pkey, s.pval);
                    }
                    break;
            }
        }
        node.pushEnd(payload);
        this._bumpVersion();
    }
    /** Снять payload из всех узлов роутера (и deep, и end). */
    removePayload(payload) {
        const stack = [this._root];
        while (stack.length) {
            const n = stack.pop();
            if (n.end) {
                n.end.delete(payload);
                if (n.end.size === 0)
                    n.end = null;
            }
            if (n.deep) {
                n.deep.delete(payload);
                if (n.deep.size === 0)
                    n.deep = null;
            }
            if (n.exact) {
                for (const k in n.exact) {
                    const child = n.exact[k];
                    if (child)
                        stack.push(child);
                }
            }
            if (n.wc)
                stack.push(n.wc);
            if (n.param) {
                for (const pk in n.param) {
                    const bucket = n.param[pk];
                    if (bucket) {
                        for (const pv in bucket) {
                            const child = bucket[pv];
                            if (child)
                                stack.push(child);
                        }
                    }
                }
            }
        }
        this._bumpVersion();
    }
    /** Удалить маршрут. Если payload опущен — снимаем все payload'ы по маске. */
    remove(mask, payload) {
        const segs = this._getSegs(mask);
        const stack = [];
        let node = this._root;
        stack.push({ node });
        for (let i = 0; i < segs.length; i++) {
            const s = segs[i];
            const last = i === segs.length - 1;
            if (s.kind === SegKind.Wildcard && last) {
                if (node.deep) {
                    if (payload)
                        node.deep.delete(payload);
                    else
                        node.deep.clear();
                    if (node.deep.size === 0)
                        node.deep = null;
                    this._bumpVersion();
                }
                return;
            }
            if (s.kind === SegKind.Key) {
                const key = keyLiteralStr(s.key);
                const next = node.exact?.[key];
                if (!next)
                    return;
                stack.push({ node: next, via: { typ: 'exact', key } });
                node = next;
            }
            else if (s.kind === SegKind.Index) {
                const key = keyIndex(s.index);
                const next = node.exact?.[key];
                if (!next)
                    return;
                stack.push({ node: next, via: { typ: 'exact', key } });
                node = next;
            }
            else if (s.kind === SegKind.Wildcard) {
                const next = node.wc;
                if (!next)
                    return;
                stack.push({ node: next, via: { typ: 'wc' } });
                node = next;
            }
            else {
                const pk = s.pkey;
                const pvKey = keyParam(pk, s.pval);
                const next = node.param?.[pk]?.[pvKey];
                if (!next)
                    return;
                stack.push({ node: next, via: { typ: 'param', pk, pvKey } });
                node = next;
            }
        }
        if (node.end) {
            if (payload)
                node.end.delete(payload);
            else
                node.end.clear();
            if (node.end.size === 0)
                node.end = null;
            this._bumpVersion();
        }
    }
    /** Удалить все маршруты и сбросить кэши */
    removeAll() {
        this._root = new RouterNode();
        this.resetCaches();
    }
    /** Подобрать все payload'ы для конкретного пути (точный матч масок + deep/wildcard) */
    match(path) {
        const pathKey = this._toKey(path);
        const cached = this._cacheMatchRead(pathKey);
        if (cached)
            return cached;
        const segs = this._getSegs(path);
        const out = new Set();
        const stack = [{ node: this._root, i: 0 }];
        while (stack.length) {
            const { node, i } = stack.pop();
            // deep-payload: валидны для любого хвоста (включая пустой)
            if (node.deep)
                for (const p of node.deep)
                    out.add(p);
            if (i === segs.length) {
                if (node.end)
                    for (const p of node.end)
                        out.add(p);
                continue;
            }
            const s = segs[i];
            // 1) точный переход
            if (node.exact) {
                if (s.kind === SegKind.Key) {
                    const nx = node.exact[keyLiteralStr(s.key)];
                    if (nx)
                        stack.push({ node: nx, i: i + 1 });
                }
                else if (s.kind === SegKind.Index) {
                    const nx = node.exact[keyIndex(s.index)];
                    if (nx)
                        stack.push({ node: nx, i: i + 1 });
                }
                // Param / Wildcard цели не появляются в exact-ветке
            }
            // 2) одиночный wildcard-переход (любой один сегмент)
            if (node.wc) {
                stack.push({ node: node.wc, i: i + 1 });
            }
            // 3) параметризованный переход (для [pk=pv] в пути)
            // существующая логика:
            if (node.param && s.kind === SegKind.Param) {
                const bucket = node.param[s.pkey];
                if (bucket) {
                    const nx = bucket[keyParam(s.pkey, s.pval)];
                    if (nx)
                        stack.push({ node: nx, i: i + 1 });
                }
            }
            // дополнительная логика: если у узла есть paramAny для этого ключа,
            // то любое (s.pval) проходит через этот child
            if (node.paramAny && s.kind === SegKind.Param) {
                const anyEntry = node.paramAny[s.pkey];
                if (anyEntry) {
                    stack.push({ node: anyEntry.node, i: i + 1 });
                    // Можно здесь также записывать varName->s.pval в captures (если захотим возвращать params)
                }
            }
            // внутри while-stack цикла, после блока node.paramAny && s.kind===Param:
            if (node.paramAny && s.kind === SegKind.Index) {
                const anyEntry = node.paramAny['$index'];
                if (anyEntry) {
                    stack.push({ node: anyEntry.node, i: i + 1 });
                }
            }
        }
        this._cacheMatchWrite(pathKey, out);
        return out;
    }
    matchWithParams(path) {
        const segs = this._getSegs(path);
        const stack = [{ node: this._root, i: 0, caps: {} }];
        const out = [];
        while (stack.length) {
            const { node, i, caps } = stack.pop();
            // deep-payload: валидны для любого хвоста
            if (node.deep) {
                for (const p of node.deep)
                    out.push({ payload: p, params: caps });
            }
            if (i === segs.length) {
                if (node.end) {
                    for (const p of node.end)
                        out.push({ payload: p, params: caps });
                }
                continue;
            }
            const s = segs[i];
            // 1) точные переходы
            if (node.exact) {
                if (s.kind === SegKind.Key) {
                    const nx = node.exact[keyLiteralStr(s.key)];
                    if (nx)
                        stack.push({ node: nx, i: i + 1, caps });
                }
                else if (s.kind === SegKind.Index) {
                    const nx = node.exact[keyIndex(s.index)];
                    if (nx)
                        stack.push({ node: nx, i: i + 1, caps });
                }
            }
            // 2) одиночный wildcard
            if (node.wc) {
                stack.push({ node: node.wc, i: i + 1, caps });
            }
            // 3) параметризованный: точное значение
            if (node.param && s.kind === SegKind.Param) {
                const bucket = node.param[s.pkey];
                if (bucket) {
                    const nx = bucket[keyParam(s.pkey, s.pval)];
                    if (nx)
                        stack.push({ node: nx, i: i + 1, caps });
                }
            }
            // 4) параметризованный: плейсхолдер ($var)
            if (node.paramAny && s.kind === SegKind.Param) {
                const anyEntry = node.paramAny[s.pkey];
                if (anyEntry) {
                    let nextCaps = caps;
                    // захватываем фактическое значение для varName
                    nextCaps = { ...caps, [anyEntry.varName]: s.pval };
                    stack.push({ node: anyEntry.node, i: i + 1, caps: nextCaps });
                }
            }
            if (node.paramAny && s.kind === SegKind.Index) {
                const anyEntry = node.paramAny['$index'];
                if (anyEntry) {
                    const nextCaps = { ...caps, [anyEntry.varName]: s.index };
                    stack.push({ node: anyEntry.node, i: i + 1, caps: nextCaps });
                }
            }
        }
        return out;
    }
    /**
     * Удобный объединённый режим: exact-матч по пути + все подписки "внизу" префикса.
     * Полезно для семантики "изменился родитель - оповестить всех подписчиков глубже".
     */
    matchIncludingPrefix(path) {
        const exact = this.match(path);
        const below = this.collectByPrefix(path);
        if (below.size === 0)
            return exact;
        const out = new Set(exact);
        for (const p of below)
            out.add(p);
        return out;
    }
    /** Объединённый режим с параметрами:
     *  - точный матч по path (как matchWithParams)
     *  - плюс все подписки, лежащие "ниже" этого префикса.
     *  Переменные ($var), встреченные по пути до узла префикса, попадают в params.
     *  Переменные, встречающиеся глубже префикса, не заполняются (значений у нас нет).
     */
    matchIncludingPrefixWithParams(path) {
        const segs = this._getSegs(path);
        // --- 1) exact-путь: как matchWithParams (упрощённо, без кэша — обычно это недорогая часть)
        const exact = [];
        {
            const stack = [{ node: this._root, i: 0, params: {} }];
            while (stack.length) {
                const { node, i, params } = stack.pop();
                // deep: всегда валидны (включая пустой хвост)
                if (node.deep) {
                    for (const p of node.deep)
                        exact.push({ payload: p, params: { ...params } });
                }
                if (i === segs.length) {
                    if (node.end) {
                        for (const p of node.end)
                            exact.push({ payload: p, params: { ...params } });
                    }
                    continue;
                }
                const s = segs[i];
                // точные переходы Key/Index
                if (node.exact) {
                    if (s.kind === SegKind.Key) {
                        const nx = node.exact[keyLiteralStr(s.key)];
                        if (nx)
                            stack.push({ node: nx, i: i + 1, params });
                    }
                    else if (s.kind === SegKind.Index) {
                        const nx = node.exact[keyIndex(s.index)];
                        if (nx)
                            stack.push({ node: nx, i: i + 1, params });
                    }
                }
                // wildcard-ребёнок (любой один сегмент)
                if (node.wc) {
                    stack.push({ node: node.wc, i: i + 1, params });
                }
                // параметризованный переход: literal
                if (node.param && s.kind === SegKind.Param) {
                    const bucket = node.param[s.pkey];
                    if (bucket) {
                        const nx = bucket[keyParam(s.pkey, s.pval)];
                        if (nx)
                            stack.push({ node: nx, i: i + 1, params });
                    }
                }
                // параметризованный переход: placeholder ($var) — захватываем
                if (node.paramAny && s.kind === SegKind.Param) {
                    const entry = node.paramAny[s.pkey];
                    if (entry) {
                        const cap = { ...params, [entry.varName]: s.pval };
                        stack.push({ node: entry.node, i: i + 1, params: cap });
                    }
                }
                if (node.paramAny && s.kind === SegKind.Index) {
                    const entry = node.paramAny['$index'];
                    if (entry) {
                        const cap = { ...params, [entry.varName]: s.index };
                        stack.push({ node: entry.node, i: i + 1, params: cap });
                    }
                }
            }
        }
        // --- 2) префикс: спуститься по segs до всех возможных узлов и собрать всё "ниже"
        //      (с унаследованными params, которые мы могли захватить по дороге)
        const below = [];
        const seeds = (() => {
            const start = [{ node: this._root, i: 0, params: {} }];
            const out = [];
            while (start.length) {
                const { node, i, params } = start.pop();
                if (i === segs.length) {
                    out.push({ node, params });
                    continue;
                }
                const s = segs[i];
                // точные Key/Index
                if (node.exact) {
                    if (s.kind === SegKind.Key) {
                        const nx = node.exact[keyLiteralStr(s.key)];
                        if (nx)
                            start.push({ node: nx, i: i + 1, params });
                    }
                    else if (s.kind === SegKind.Index) {
                        const nx = node.exact[keyIndex(s.index)];
                        if (nx)
                            start.push({ node: nx, i: i + 1, params });
                    }
                }
                // wildcard в самом префиксе трактуем как «неопределённый» префикс
                // (обычно в префиксе не используется)
                if (s.kind === SegKind.Wildcard) {
                    // нет однозначного узла-три, просто ничего не добавляем
                }
                // param literal
                if (node.param && s.kind === SegKind.Param) {
                    const bucket = node.param[s.pkey];
                    if (bucket) {
                        const nx = bucket[keyParam(s.pkey, s.pval)];
                        if (nx)
                            start.push({ node: nx, i: i + 1, params });
                    }
                }
                // param placeholder ($var) — захватываем
                if (node.paramAny && s.kind === SegKind.Param) {
                    const entry = node.paramAny[s.pkey];
                    if (entry) {
                        const cap = { ...params, [entry.varName]: s.pval };
                        start.push({ node: entry.node, i: i + 1, params: cap });
                    }
                }
                // индекс-плейсхолдер [$var] — тоже должен проходить и захватывать
                if (node.paramAny && s.kind === SegKind.Index) {
                    const entry = node.paramAny['$index'];
                    if (entry) {
                        const cap = { ...params, [entry.varName]: s.index };
                        start.push({ node: entry.node, i: i + 1, params: cap });
                    }
                }
            }
            return out;
        })();
        // DFS по поддереву каждого seed-узла: собираем deep и end.
        for (const seed of seeds) {
            const stack = [seed];
            while (stack.length) {
                const { node, params } = stack.pop();
                if (node.deep) {
                    for (const p of node.deep)
                        below.push({ payload: p, params: { ...params } });
                }
                if (node.end) {
                    for (const p of node.end)
                        below.push({ payload: p, params: { ...params } });
                }
                if (node.exact) {
                    for (const k in node.exact) {
                        const child = node.exact[k];
                        if (child)
                            stack.push({ node: child, params });
                    }
                }
                if (node.wc) {
                    stack.push({ node: node.wc, params });
                }
                if (node.param) {
                    for (const pk in node.param) {
                        const bucket = node.param[pk];
                        if (bucket) {
                            for (const pv in bucket) {
                                const child = bucket[pv];
                                if (child)
                                    stack.push({ node: child, params });
                            }
                        }
                    }
                }
                if (node.paramAny) {
                    for (const pk in node.paramAny) {
                        const entry = node.paramAny[pk];
                        if (entry?.node) {
                            // Глубже префикса мы НЕ знаем конкретное значение переменной — оно остаётся незаполненным.
                            // Пихаем наследованные params как есть.
                            stack.push({ node: entry.node, params });
                        }
                    }
                }
            }
        }
        // --- 3) слить exact + below и убрать дубликаты
        const seen = new Map(); // payload (по ссылке) -> множество строк params
        const out = [];
        const pushUnique = (arr) => {
            for (const e of arr) {
                const paramsKey = JSON.stringify(e.params ?? {});
                let bucket = seen.get(e.payload);
                if (!bucket) {
                    bucket = new Set();
                    seen.set(e.payload, bucket);
                }
                if (!bucket.has(paramsKey)) {
                    bucket.add(paramsKey);
                    out.push(e);
                }
            }
        };
        pushUnique(exact);
        pushUnique(below);
        return out;
    }
    /**
     * Собрать все payload’ы, зарегистрированные "ниже" указанного префикса пути.
     * Включает payload’ы, привязанные к:
     *  - node.end на узле префикса и его потомках;
     *  - node.deep на узле префикса и его потомках.
     * Не включает deep/ end предков (их даст обычный match()).
     */
    collectByPrefix(prefix) {
        const pathKey = this._toKey(prefix);
        const cached = this._cachePrefixRead(pathKey);
        if (cached)
            return cached;
        const segs = this._getSegs(prefix);
        // 1) Спускаемся по trie ровно по сегментам префикса
        let node = this._root;
        for (let i = 0; i < segs.length; i++) {
            if (!node)
                break;
            const s = segs[i];
            if (s.kind === SegKind.Key) {
                node = node.exact?.[keyLiteralStr(s.key)] ?? null;
            }
            else if (s.kind === SegKind.Index) {
                node = node.exact?.[keyIndex(s.index)] ?? null;
            }
            else if (s.kind === SegKind.Param) {
                const bucket = node.param?.[s.pkey];
                node = bucket ? (bucket[keyParam(s.pkey, s.pval)] ?? null) : null;
            }
            else {
                // В префиксе (конкретном пути) wildcard не должен встречаться.
                // Если встретился — префикс неопределён; возвращаем пусто.
                node = null;
            }
        }
        if (!node) {
            const empty = new Set();
            this._cachePrefixWrite(pathKey, empty);
            return empty;
        }
        // 2) DFS по поддереву, собираем deep и end
        const out = new Set();
        const stack = [node];
        while (stack.length) {
            const n = stack.pop();
            if (n.deep)
                for (const p of n.deep)
                    out.add(p);
            if (n.end)
                for (const p of n.end)
                    out.add(p);
            if (n.exact) {
                for (const k in n.exact) {
                    const child = n.exact[k];
                    if (child)
                        stack.push(child);
                }
            }
            if (n.wc)
                stack.push(n.wc);
            if (n.param) {
                for (const pk in n.param) {
                    const bucket = n.param[pk];
                    if (bucket) {
                        for (const pv in bucket) {
                            const child = bucket[pv];
                            if (child)
                                stack.push(child);
                        }
                    }
                }
            }
        }
        this._cachePrefixWrite(pathKey, out);
        return out;
    }
    /** Сбросить все кэши вручную. */
    resetCaches() {
        this._segCache.clear();
        this._matchCache.clear();
        this._prefixCache.clear();
        this._version++;
    }
}
//# sourceMappingURL=RaphRouter.js.map