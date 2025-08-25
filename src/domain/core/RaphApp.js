import { SchedulerType } from '@/domain/types/base.types';
import { DefaultDataAdapter } from '@/domain/entities/DataAdapter';
import { RaphRouter } from '@/domain/core/RaphRouter';
import { DepGraph } from '@/domain/entities/DepGraph';
import { DataPath } from '@/domain/entities/DataPath';
import { MinHeap } from '@/domain/entities/MinHeap';
export class RaphApp {
    //
    // Константы
    //
    _maxUps = 60;
    _minUpdateInterval = 1000 / 60;
    static PRIORITY_SCALE = 1 << 20; // ~1 млн: с запасом для weight
    //
    // Подмодули
    //
    _dataAdapter = new DefaultDataAdapter();
    _nodeRouter = new RaphRouter();
    _phaseRouter = new RaphRouter();
    _graph = new DepGraph();
    //
    // Планировщик для запуска фаз
    //
    _scheduler = (cb) => cb();
    _schedulerType = SchedulerType.AnimationFrame;
    _schedulerPending = false;
    //
    // Данные (Dirty логика)
    //
    _dirty = new Map();
    _phaseBits = new Map(); // фаза -> бит
    //
    // Фазы
    //
    _phasesArray = [];
    _phasesMap = new Map();
    //
    // Debug
    //
    __ups = 0;
    __lastUPSUpdate = performance.now();
    __upsCount = 0;
    __isLoopActive = false;
    __lastTime = performance.now();
    __animationFrameId = null;
    __upsResetTimeout = null;
    //
    //
    constructor() { }
    /**
     * Изменение опций
     */
    options(opts) {
        if (opts.maxUps !== undefined)
            this._maxUps = opts.maxUps;
        if (opts.adapter !== undefined)
            this._dataAdapter = opts.adapter;
        if (opts.scheduler !== undefined) {
            this.setScheduler(opts.scheduler);
        }
        //
        this._minUpdateInterval = 1000 / this._maxUps;
    }
    /**
     * Определяет все фазы разом.
     * Сохраняет их и в массив (для последовательного обхода),
     * и в Map (для быстрого доступа по имени).
     */
    definePhases(phases) {
        this._phasesArray = phases;
        this._phasesMap.clear();
        this._phaseBits.clear();
        phases.forEach((p, i) => this._phaseBits.set(p.name, 1 << i));
        // Пересобираем фазовый роутер с нуля: маска -> имя фазы
        this._phaseRouter = new RaphRouter();
        for (const phase of phases) {
            this._phasesMap.set(phase.name, phase);
            for (const mask of phase.routes ?? []) {
                // если список маршрутов пуст — фаза никогда не триггерится по данным
                this._phaseRouter.add(mask, phase.name);
            }
        }
    }
    /**
     * Получить узел по ID
     */
    getNode(id) {
        return this._graph.getNode(id);
    }
    /**
     * Добавляет узел в корневой узел
     */
    addNode(node) {
        return this._graph.addNode(node);
    }
    /**
     * Удалить зарегистрированный узел из RaphApp.
     */
    removeNode(node) {
        this._graph.removeNode(node.id);
    }
    addDependency(parent, child) {
        return this._graph.addEdge(parent.id, child.id);
    }
    removeDependency(parent, child) {
        this._graph.removeEdge(parent.id, child.id);
    }
    /**
     * Установить планировщик для запуска фаз
     */
    setScheduler(mode) {
        if (mode === SchedulerType.Microtask) {
            this._scheduler = (cb) => queueMicrotask(cb);
        }
        else if (mode === SchedulerType.AnimationFrame) {
            this._scheduler = (cb) => requestAnimationFrame(cb);
        }
        else {
            this._scheduler = (cb) => cb();
        }
        this._schedulerType = mode;
    }
    /**
     * Уведомление об изменении данных.
     * Вызывается при изменении данных в RaphApp.
     */
    notify(path, opts) {
        const { invalidate = true } = opts ?? {};
        const evtPath = DataPath.from(path);
        if (this._phasesArray.length === 0)
            return;
        // 1) Какие фазы вообще интересуются этим путём?
        const phaseHits = this._phaseRouter.matchIncludingPrefix(evtPath); // Set<PhaseName>
        if (phaseHits.size === 0)
            return;
        // 2) Базовый набор нод по событию — один раз для всех фаз
        // const baseNodes = this._nodeRouter.matchIncludingPrefix(evtPath)
        const matchesWithParams = this._nodeRouter.matchIncludingPrefixWithParams?.(evtPath) ?? [];
        const nodeParams = new Map();
        let baseNodes = new Set();
        if (matchesWithParams.length) {
            for (const m of matchesWithParams) {
                baseNodes.add(m.payload);
                nodeParams.set(m.payload.id, m.params ?? {});
            }
        }
        else {
            // фоллбек на старый Set без params
            baseNodes = this._nodeRouter.match(evtPath);
        }
        // 3) Мемоизация расширений по типу traversal, чтобы не пересчитывать
        const expandedCache = new Map();
        const getExpanded = (traversal) => {
            let s = expandedCache.get(traversal);
            if (s)
                return s;
            if (traversal === 'all') {
                s = this._graph.expandByTraversal(null, 'all');
            }
            else {
                s =
                    baseNodes.size > 0
                        ? this._graph.expandByTraversal(baseNodes, traversal)
                        : new Set();
            }
            expandedCache.set(traversal, s);
            return s;
        };
        // 4) Для каждой фазы раскладываем соответствующие ноды в бакеты
        for (const phaseName of phaseHits) {
            const phase = this._phasesMap.get(phaseName);
            if (!phase)
                continue;
            if (phase.traversal !== 'all' && baseNodes.size === 0) {
                // нет базовых нод — фаза со специальным обходом не сработает
                continue;
            }
            const expanded = getExpanded(phase.traversal);
            if (expanded.size === 0)
                continue;
            for (const node of expanded) {
                this.dirty(phase.name, node, {
                    invalidate,
                    event: { path: evtPath, params: nodeParams.get(node.id) },
                });
            }
        }
    }
    /**
     * Пометить узел dirty в фазе
     */
    dirty(phase, node, opts) {
        const phaseInstance = this._phasesMap.get(phase);
        if (!phaseInstance) {
            console.warn(`[RaphApp] Phase "${phase}" not found`);
            return;
        }
        // Фильтр по узлам (массив типов)
        if (phaseInstance.nodes &&
            Array.isArray(phaseInstance.nodes) &&
            !phaseInstance.nodes.includes(node.type)) {
            return;
        }
        // Фильтр по узлам (лямбда-функция)
        if (phaseInstance.nodes &&
            typeof phaseInstance.nodes === 'function' &&
            !phaseInstance.nodes(node)) {
            return;
        }
        const { invalidate = true, event } = opts ?? {};
        const bit = this._phaseBits.get(phase) ?? 0;
        if (bit && node['__dirtyPhasesMask'] & bit)
            return;
        const idx = this._priority(node);
        const q = this._getPhaseDirty(phase);
        let arr = q.buckets.get(idx);
        if (!arr) {
            arr = [];
            q.buckets.set(idx, arr);
        }
        arr.push(node);
        if (!q.inHeap.has(idx)) {
            q.inHeap.add(idx);
            q.heap.push(idx);
        }
        if (event) {
            const list = q.events.get(node.id);
            if (list)
                list.push(event);
            else
                q.events.set(node.id, [event]);
        }
        if (bit)
            node['__dirtyPhasesMask'] |= bit;
        if (invalidate)
            this.invalidate();
    }
    /**
     * Итерация реактивного графа.
     * Обновляет грязные узлы в контексте фаз.
     * Если грязных узлов нет — ничего не делает.
     */
    run() {
        const now = performance.now();
        this.__upsCount++;
        if (now - this.__lastUPSUpdate >= 1000) {
            this.__ups = this.__upsCount;
            this.__upsCount = 0;
            this.__lastUPSUpdate = now;
        }
        if (!this.loopEnabled) {
            if (this.__upsResetTimeout !== null) {
                clearTimeout(this.__upsResetTimeout);
            }
            this.__upsResetTimeout = setTimeout(() => {
                this.__ups = 0;
                this.__upsResetTimeout = null;
            }, 1500);
        }
        for (const phase of this._phasesArray) {
            const q = this._dirty.get(phase.name);
            if (!q || q.inHeap.size === 0)
                continue;
            while (!q.heap.empty) {
                const bucketIdx = q.heap.pop();
                q.inHeap.delete(bucketIdx);
                const arr = q.buckets.get(bucketIdx);
                if (!arr || arr.length === 0)
                    continue;
                for (let i = 0; i < arr.length; i++) {
                    const node = arr[i];
                    const events = q.events?.get(node.id) ?? undefined;
                    const bit = this._phaseBits.get(phase.name) ?? 0;
                    if (bit)
                        node['__dirtyPhasesMask'] &= ~bit;
                    phase.executor({ phase: phase.name, node, events });
                }
                // Было: arr.length = 0 (оставляли пустой массив в Map).
                // Станет: удаляем ключ, чтобы Map не росла бесконечно.
                q.buckets.delete(bucketIdx);
                q.events.clear();
            }
        }
    }
    /**
     * Получить значение по пути.
     */
    get(path, opts) {
        return this._dataAdapter.get(path, opts);
    }
    /**
     * Установить значение по пути.
     */
    set(path, value, opts) {
        this._dataAdapter.set(path, value, opts);
        this.notify(path, opts);
    }
    /**
     * Слияние значение по пути.
     */
    merge(path, value, opts) {
        this._dataAdapter.merge(path, value, opts);
        this.notify(path, opts);
    }
    /**
     * Удалить значение по пути.
     */
    delete(path, opts) {
        this._dataAdapter.delete(path, opts);
        this.notify(path, opts);
    }
    /**
     * Запускает цикл обновления по
     * заданному планировщику
     */
    startLoop() {
        if (this.__isLoopActive)
            return;
        this.__isLoopActive = true;
        const loop = (time) => {
            if (!this.__isLoopActive)
                return;
            this.invalidate();
            if (this._schedulerType === SchedulerType.AnimationFrame) {
                this.__animationFrameId = requestAnimationFrame(loop);
            }
            else {
                queueMicrotask(() => loop(performance.now()));
            }
        };
        loop(this.__lastTime);
    }
    /**
     * Остановить цикл обновления.
     */
    stopLoop() {
        this.__isLoopActive = false;
        this.__ups = 0;
        if (this.__animationFrameId !== null) {
            cancelAnimationFrame(this.__animationFrameId);
            this.__animationFrameId = null;
        }
        if (this.__upsResetTimeout !== null) {
            clearTimeout(this.__upsResetTimeout);
            this.__upsResetTimeout = null;
        }
    }
    /**
     * Функция, которая помечает core, требующим обновления.
     * Однако обновления произойдет только, если есть грязные узлы.
     */
    invalidate() {
        if (this._schedulerPending)
            return;
        this._schedulerPending = true;
        this._scheduler(() => {
            this._schedulerPending = false;
            this.run();
        });
    }
    /**
     * Полная очистка RaphApp состояния
     */
    reset() {
        // Удаляем всех потомков _root-ноды
        // ToDo:
        this._nodeRouter.removeAll();
    }
    //
    // PRIVATE
    //
    /**
     * Зарегистрировать зависимость ноды от пути/маски.
     * dep может быть: строка ("rows[0].x"), DataPath или plain-JSON.
     * Возвращает стабильный ключ (бренд-строку), по которому хранится подписка.
     */
    track(node, mask) {
        this._nodeRouter.add(mask, node);
    }
    /**
     * Снять зависимость ноды. Если dep не передан — снимаем все зависимости ноды.
     */
    untrack(node, mask) {
        if (!mask) {
            // Снимаем все зависимости
            this._nodeRouter.removePayload(node);
            return;
        }
        this._nodeRouter.remove(mask, node);
    }
    //
    // PRIVATE
    //
    _getPhaseDirty(phase) {
        let q = this._dirty.get(phase);
        if (!q) {
            q = {
                buckets: new Map(),
                heap: new MinHeap(),
                inHeap: new Set(),
                events: new Map(),
            };
            this._dirty.set(phase, q);
        }
        return q;
    }
    _priority(node) {
        // depth растёт - индекс растёт - обрабатываем раньше те, у кого depth меньше.
        // внутри одного depth: больший weight должен пойти раньше,
        // поэтому вычитаем weight (меньший индекс = выше приоритет).
        const depth = this._graph.getDepth(node);
        return depth * RaphApp.PRIORITY_SCALE - node.weight;
    }
    //
    // GETTERS / SETTERS
    //
    get data() {
        return this._dataAdapter.root();
    }
    get loopEnabled() {
        return this.__isLoopActive;
    }
    get maxUps() {
        return this._maxUps;
    }
    get minUpdateInterval() {
        return this._minUpdateInterval;
    }
    get weightLimit() {
        return this._weightLimit;
    }
    get maxDepth() {
        return this._maxDepth;
    }
    get totalBuckets() {
        return this._totalBuckets;
    }
    get dataAdapter() {
        return this._dataAdapter;
    }
    // Возвращает фазы в порядке исполнения
    get phases() {
        return this._phasesArray;
    }
    // Быстрый доступ к фазе по имени
    getPhase(name) {
        return this._phasesMap.get(name);
    }
}
//# sourceMappingURL=RaphApp.js.map