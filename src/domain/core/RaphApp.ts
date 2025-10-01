import type {
  DataAdapter,
  DataObject,
  DataPathDef,
  PhaseDirty,
  RaphOptions,
  RaphScheduler,
  Undefinable,
} from 'domain/types/base.types'
import { SchedulerType } from '@/domain/types/base.types'
import { DefaultDataAdapter } from '@/domain/entities/DataAdapter'
import type { RaphNode } from '@/domain/core/RaphNode'
import { RaphRouter } from '@/domain/core/RaphRouter'
import type {
  PhaseEvent,
  PhaseName,
  RaphPhase,
  ResolvedEntry,
} from '@/domain/types/phase.types'
import { DepGraph } from '@/domain/entities/DepGraph'
import { DataPath } from '@/domain/entities/DataPath'
import { MinHeap } from '@/domain/entities/MinHeap'
import { SegKind } from '@/domain/types/path.types'
import { Raph } from '@/domain/core/Raph'

export class RaphApp {
  //
  // Константы
  //
  private _maxUps = 120
  private _minUpdateInterval = 1000 / 120
  private static readonly PRIORITY_SCALE = 1 << 20 // ~1 млн: с запасом для weight

  //
  // Подмодули
  //
  private _dataAdapter: DataAdapter = new DefaultDataAdapter()
  private _nodeRouter: RaphRouter<RaphNode> = new RaphRouter()
  private _phaseRouter: RaphRouter<PhaseName> = new RaphRouter()
  private _graph: DepGraph = new DepGraph()

  //
  // Планировщик для запуска фаз
  //
  private _scheduler: RaphScheduler = (cb) => cb()
  private _schedulerType: SchedulerType = SchedulerType.AnimationFrame
  private _schedulerPending = false

  //
  // Данные (Dirty логика)
  //
  private _dirty = new Map<PhaseName, PhaseDirty>()
  private _phaseBits = new Map<PhaseName, number>() // фаза -> бит

  //
  // Фазы
  //
  private _phasesArray: RaphPhase[] = []
  private _phasesMap: Map<PhaseName, RaphPhase> = new Map()

  //
  // Debug
  //
  private __debug = false
  private __ups = 0
  private __lastUPSUpdate = performance.now()
  private __upsCount = 0
  private __isLoopActive = false
  private __lastTime = performance.now()
  private __animationFrameId: number | null = null
  private __upsResetTimeout: number | null = null

  // Events per second
  private __eps = 0
  private __lastEPSUpdate = performance.now()
  private __epsCount = 0
  private __epsResetTimeout: number | null = null

  // Changed nodes per second
  private __nps = 0
  private __npsCount = 0
  private __lastNPSUpdate = performance.now()
  private __npsResetTimeout: number | null = null

  // throttleTimer для run
  private __lastRunAt = performance.now()
  private __throttleTimer: number | null = null

  //
  //
  constructor() {}

  /**
   * Изменение опций
   */
  options(opts: Partial<RaphOptions>): void {
    if (opts.maxUps !== undefined) {
      this._maxUps = opts.maxUps
    }
    if (opts.adapter !== undefined) this._dataAdapter = opts.adapter
    if (opts.scheduler !== undefined) {
      this.setScheduler(opts.scheduler)
    }
    if (opts.debug !== undefined) {
      this.__debug = opts.debug
      Raph.debug.enable(this.__debug)
    }

    //
    this._minUpdateInterval = 1000 / this._maxUps
  }

  /**
   * Определяет все фазы разом.
   * Сохраняет их и в массив (для последовательного обхода),
   * и в Map (для быстрого доступа по имени).
   * Также запускает инициализацию
   */
  definePhases(phases: RaphPhase[]): void {
    this._phasesArray = phases
    this.reinitPhases()
  }

  addPhase(phase: RaphPhase): void {
    this._phasesArray.push(phase)
  }

  clearPhases(): void {
    this._phasesArray = []
    this._phasesMap.clear()
    this.reinitPhases()
  }

  /**
   * Инициализация фаз.
   * Подразумевается, что фазы уже добавлены в this._phasesArray
   */
  reinitPhases(): void {
    this._phasesMap.clear()

    this._phaseBits.clear()
    this._phasesArray.forEach((p, i) => this._phaseBits.set(p.name, 1 << i))

    // Пересобираем фазовый роутер с нуля: маска -> имя фазы
    this._phaseRouter = new RaphRouter<PhaseName>()
    for (const phase of this._phasesArray) {
      this._phasesMap.set(phase.name, phase)
      for (const mask of phase.routes ?? []) {
        // если список маршрутов пуст — фаза никогда не триггерится по данным
        this._phaseRouter.add(mask, phase.name)
      }
    }

    Raph.events.emit('phases:reinit', {
      phases: this._phasesArray,
    })
  }

  /**
   * Получить узел по ID
   */
  getNode(id: string): RaphNode | undefined {
    return this._graph.getNode(id)
  }

  /**
   * Добавляет узел в корневой узел
   */
  addNode(node: RaphNode): void {
    this._graph.addNode(node)
    Raph.events.emit('nodes:changed', { graph: this._graph })
  }

  /**
   * Удалить зарегистрированный узел из RaphApp.
   */
  removeNode(node: RaphNode): void {
    this._graph.removeNode(node.id)
    Raph.events.emit('nodes:changed', { graph: this._graph })
  }

  addDependency(parent: RaphNode, child: RaphNode): boolean {
    const res = this._graph.addEdge(parent.id, child.id)
    Raph.events.emit('nodes:changed', { graph: this._graph })
    return res
  }

  removeDependency(parent: RaphNode, child: RaphNode): void {
    this._graph.removeEdge(parent.id, child.id)
    Raph.events.emit('nodes:changed', { graph: this._graph })
  }

  /**
   * Установить планировщик для запуска фаз
   */
  setScheduler(mode: SchedulerType): void {
    if (mode === SchedulerType.Microtask) {
      this._scheduler = (cb) => queueMicrotask(cb)
    } else if (mode === SchedulerType.AnimationFrame) {
      this._scheduler = (cb) => requestAnimationFrame(cb)
    } else {
      this._scheduler = (cb) => cb()
    }
    this._schedulerType = mode
  }
  // внутри класса RaphApp

  private _buildResolved(
    path: DataPathDef,
    vars?: Record<string, any>,
  ): {
    resolved: ResolvedEntry[]
    canonical: string
    canonicalDataPath: DataPath
  } {
    // 1) нормализованный путь (со звёздочками) для каноники/логов
    const norm = DataPath.from(path, { vars, wildcardDynamic: true })

    // 2) пройдёмся по исходным сегментам (без wildcardDynamic), чтобы увидеть реальные Param
    const segs = DataPath.from(path, { vars }).segments()

    // накапливаем "имя текущего контейнера" (последний ключевой сегмент)
    let lastContainerKey = ''
    // строим префикс пути до текущего места (для indexOf)
    let prefixStr = ''

    const pushDot = (k: string) => {
      prefixStr = prefixStr ? `${prefixStr}.${k}` : k
    }

    const resolved: ResolvedEntry[] = []

    for (const s of segs) {
      switch (s.kind) {
        case SegKind.Key: {
          const key = String(s.key!)
          lastContainerKey = key
          pushDot(key)
          break
        }
        case SegKind.Index: {
          prefixStr += `[${s.index}]`
          break
        }
        case SegKind.Param: {
          // вычислим реальное значение pval, если это путь/переменная
          let evalVal: unknown = s.pval
          if (typeof s.pval === 'string' && s.pval.startsWith('$')) {
            try {
              evalVal = this._dataAdapter.get(s.pval, { vars })
            } catch {
              // оставим как есть, индекс вероятно будет -1
            }
          }

          // построим путь до массива + [pk=evalVal] и спросим indexOf
          // пример: "FLT_ARR.attrs[legId=...]" → получим индекс этого элемента
          const idxPath =
            typeof evalVal === 'number' || typeof evalVal === 'boolean'
              ? `${prefixStr}[${s.pkey}=${String(evalVal)}]`
              : `${prefixStr}[${s.pkey}=${JSON.stringify(String(evalVal))}]`

          let index = -1
          try {
            index = this._dataAdapter.indexOf(idxPath, { vars })
          } catch {
            index = -1
          }

          resolved.push({
            segment: lastContainerKey || '', // например "attrs" / "legs"
            keyField: s.pkey!,
            keyValue: s.pval, // оставляем исходное (может быть "$store.legs[$i].id]")
            index,
          })

          // продолжим префикс, двигаясь внутрь найденного элемента массива
          if (index >= 0) {
            prefixStr += `[${index}]`
          } else {
            // если не нашли — формально двигаемся как [*], чтобы структура префикса не ломалась
            // это никак не влияет на canonical (он уже посчитан выше), нужно только для
            // последовательности шага
            prefixStr += '[*]'
          }
          break
        }
        case SegKind.Wildcard: {
          // в исходном пути редко, но поддержим как один сегмент
          // для префикса сериализуем как '.*' (не влияет на canonical/резолв)
          // префикс нам нужен только для indexOf в Param, сюда не доходим по сути
          prefixStr += prefixStr && !prefixStr.endsWith('.') ? '.*' : '*'
          break
        }
      }
    }

    return { resolved, canonical: norm.toStringPath(), canonicalDataPath: norm }
  }

  /**
   * Уведомление об изменении данных.
   * Вызывается при изменении данных в RaphApp.
   */
  notify(
    path: DataPathDef,
    opts?: { invalidate?: boolean; vars?: Record<string, any> },
  ): void {
    const { invalidate = true } = opts ?? {}

    const { canonical, canonicalDataPath, resolved } = this._buildResolved(
      path,
      opts?.vars,
    )

    // const evtPath = DataPath.from(path, {
    //   vars: opts?.vars,
    //   wildcardDynamic: true,
    // })
    if (this._phasesArray.length === 0) return

    // console.log('[RAPH NOTIFY]')
    // console.log('Path:', path)
    // console.log('Normalized:', canonical)
    // console.log('Resolved:', resolved)
    // console.log('Data', this._dataAdapter.root())

    // 1) Какие фазы вообще интересуются этим путём?
    const phaseHits = this._phaseRouter.matchIncludingPrefix(canonical) // Set<PhaseName>
    if (phaseHits.size === 0) return

    // EPS считаем за notify (если нужно — оставьте ваш текущий блок EPS тут)
    {
      this.__epsCount++
      const now = performance.now()
      if (now - this.__lastEPSUpdate >= 1000) {
        this.__eps = this.__epsCount
        this.__epsCount = 0
        this.__lastEPSUpdate = now
      }
      if (this.__epsResetTimeout !== null) clearTimeout(this.__epsResetTimeout)
      this.__epsResetTimeout = setTimeout(() => {
        this.__eps = 0
        this.__epsResetTimeout = null
      }, 1500) as any as number
    }

    // 2) Базовый набор нод по событию — один раз для всех фаз
    // const baseNodes = this._nodeRouter.matchIncludingPrefix(evtPath)

    const matches = this._nodeRouter.match?.(canonical) ?? []

    // const matchesWithParams =
    //   this._nodeRouter.matchIncludingPrefixWithParams?.(canonical) ?? []
    //
    // const nodeParams = new Map<string, Record<string, unknown>>()
    //
    // let baseNodes = new Set<RaphNode>()
    // if (matchesWithParams.length) {
    //   for (const m of matchesWithParams) {
    //     baseNodes.add(m.payload)
    //     nodeParams.set(m.payload.id, m.params ?? {})
    //   }
    // } else {
    //   // фоллбек на старый Set без params
    //   baseNodes = this._nodeRouter.match(canonical) as Set<RaphNode>
    // }

    // 3) Мемоизация расширений по типу traversal, чтобы не пересчитывать
    const expandedCache = new Map<
      'dirty-only' | 'dirty-and-down' | 'dirty-and-up' | 'all',
      Set<RaphNode>
    >()

    const getExpanded = (
      traversal: 'dirty-only' | 'dirty-and-down' | 'dirty-and-up' | 'all',
    ): Set<RaphNode> => {
      let s = expandedCache.get(traversal)
      if (s) return s

      if (traversal === 'all') {
        s = this._graph.expandByTraversal(null, 'all')
      } else {
        s =
          matches.size > 0
            ? this._graph.expandByTraversal(matches, traversal)
            : new Set()
      }
      expandedCache.set(traversal, s)
      return s
    }

    let affectedNodesTotal = 0

    // 4) Для каждой фазы раскладываем соответствующие ноды в бакеты
    for (const phaseName of phaseHits) {
      const phase = this._phasesMap.get(phaseName)
      if (!phase) continue

      if (phase.traversal !== 'all' && matches.size === 0) {
        // нет базовых нод — фаза со специальным обходом не сработает
        continue
      }

      const expanded = getExpanded(phase.traversal)
      // console.log('Phase:', phase.name)
      // console.log('Traversal:', phase.traversal)
      // console.log('Nodes:', expanded)

      affectedNodesTotal += expanded.size

      if (expanded.size === 0) continue

      for (const node of expanded) {
        this.dirty(phase.name, node, {
          invalidate,
          event: {
            original: path,
            canonical,
            canonicalDataPath,
            resolved,
          },
        })
      }
    }

    if (affectedNodesTotal > 0) {
      const now = performance.now()
      this.__npsCount += affectedNodesTotal
      if (now - this.__lastNPSUpdate >= 1000) {
        this.__nps = this.__npsCount
        this.__npsCount = 0
        this.__lastNPSUpdate = now
      }
      if (this.__npsResetTimeout !== null) clearTimeout(this.__npsResetTimeout)
      this.__npsResetTimeout = setTimeout(() => {
        this.__nps = 0
        this.__npsResetTimeout = null
      }, 1500) as any as number
    }

    // console.log('-------------')
  }

  /**
   * Пометить узел dirty в фазе
   */
  dirty(
    phase: PhaseName,
    node: RaphNode,
    opts?: { invalidate: boolean; event?: PhaseEvent },
  ): void {
    const phaseInstance = this._phasesMap.get(phase)
    if (!phaseInstance) {
      console.warn(`[RaphApp] Phase "${phase}" not found`)
      return
    }

    // Фильтр по узлам (массив типов)
    if (
      phaseInstance.nodes &&
      Array.isArray(phaseInstance.nodes) &&
      !phaseInstance.nodes.includes(node.type)
    ) {
      return
    }

    // Фильтр по узлам (лямбда-функция)
    if (
      phaseInstance.nodes &&
      typeof phaseInstance.nodes === 'function' &&
      !phaseInstance.nodes(node)
    ) {
      return
    }

    const { invalidate = true, event } = opts ?? {}

    const bit = this._phaseBits.get(phase) ?? 0
    if (bit && (node as any)['__dirtyPhasesMask'] & bit) return

    const idx = this._priority(node)
    const q = this._getPhaseDirty(phase)

    let arr = q.buckets.get(idx)
    if (!arr) {
      arr = []
      q.buckets.set(idx, arr)
    }
    arr.push(node)

    //
    if (!q.inHeap.has(idx)) {
      q.inHeap.add(idx)
      q.heap.push(idx)
    }

    if (event) {
      const list = q.events.get(node.id)
      if (list) list.push(event)
      else q.events.set(node.id, [event])
    }

    if (bit) (node as any)['__dirtyPhasesMask'] |= bit
    if (invalidate) this.invalidate()
  }

  private _scheduleRunThrottled(): void {
    // уже ждём слота — коалесцируем
    if (this.__throttleTimer !== null || this._schedulerPending) return

    const now = performance.now()
    const elapsed = now - this.__lastRunAt
    const delay = Math.max(0, this._minUpdateInterval - elapsed)

    if (delay === 0) {
      // можно сразу запланировать через выбранный планировщик
      this._schedulerPending = true
      this._scheduler(() => {
        this._schedulerPending = false
        this.run()
      })
    } else {
      // ставим один таймер до ближайшего слота (коалесцируем все invalidate)
      this.__throttleTimer = setTimeout(() => {
        this.__throttleTimer = null
        // защитимся от гонок: если кто-то успел поставить _schedulerPending — коалесцируем
        if (this._schedulerPending) return
        this._schedulerPending = true
        this._scheduler(() => {
          this._schedulerPending = false
          this.run()
        })
      }, delay) as any as number
    }
  }

  /**
   * Итерация реактивного графа.
   * Обновляет грязные узлы в контексте фаз.
   * Если грязных узлов нет — ничего не делает.
   */
  run(): void {
    this.__lastRunAt = performance.now()

    const now = this.__lastRunAt
    this.__upsCount++
    if (now - this.__lastUPSUpdate >= 1000) {
      this.__ups = this.__upsCount
      this.__upsCount = 0
      this.__lastUPSUpdate = now
    }

    if (!this.loopEnabled) {
      if (this.__upsResetTimeout !== null) {
        clearTimeout(this.__upsResetTimeout)
      }
      this.__upsResetTimeout = setTimeout(() => {
        this.__ups = 0
        this.__upsResetTimeout = null
      }, 1500) as any as number
    }

    for (const phase of this._phasesArray) {
      const q = this._dirty.get(phase.name)!
      if (!q || q.inHeap.size === 0) continue

      const bit = this._phaseBits.get(phase.name) ?? 0

      if ('all' in phase && typeof phase.all === 'function') {
        // Собираем все dirty-ноды по всем bucket
        const ctxs: Array<{
          phase: PhaseName
          node: RaphNode
          events?: PhaseEvent[]
        }> = []

        for (const bucketIdx of q.inHeap) {
          const arr = q.buckets.get(bucketIdx)
          if (!arr || arr.length === 0) continue

          for (let i = 0; i < arr.length; i++) {
            const node = arr[i]
            if (bit) (node as any)['__dirtyPhasesMask'] &= ~bit
            const events = q.events?.get(node.id) ?? undefined
            ctxs.push({ phase: phase.name, node, events })
          }

          q.buckets.delete(bucketIdx)
        }

        q.events.clear()
        q.inHeap.clear()
        q.heap.clear()

        // Единый вызов all()
        phase.all(ctxs)
        Raph.events.emit('nodes:notified', { ctxs })
      } else if ('each' in phase && typeof phase.each === 'function') {
        // По бакетам
        while (!q.heap.empty) {
          const bucketIdx = q.heap.pop()!
          q.inHeap.delete(bucketIdx)

          const arr = q.buckets.get(bucketIdx)
          if (!arr || arr.length === 0) continue

          for (let i = 0; i < arr.length; i++) {
            const node = arr[i]
            if (bit) (node as any)['__dirtyPhasesMask'] &= ~bit
            const events = q.events?.get(node.id) ?? undefined
            phase.each({ phase: phase.name, node, events })
            Raph.events.emit('node:notified', { node, event: events ?? null })
          }

          q.buckets.delete(bucketIdx)
        }

        q.events.clear()
      }
    }
  }

  /**
   * Получить значение по пути.
   */
  get(
    path: DataPathDef,
    opts?: {
      vars?: Record<string, any>
    },
  ): Undefinable<unknown> {
    return this._dataAdapter.get(path, opts)
  }

  /**
   * Установить значение по пути.
   */
  set(
    path: DataPathDef,
    value: unknown,
    opts?: { invalidate?: boolean; vars?: Record<string, any> },
  ): void {
    this._dataAdapter.set(path, value, opts)
    this.notify(path, opts)
  }

  /**
   * Слияние значение по пути.
   */
  merge(
    path: DataPathDef,
    value: unknown,
    opts?: { invalidate?: boolean; vars?: Record<string, any> },
  ): void {
    this._dataAdapter.merge(path, value, opts)
    this.notify(path, opts)
  }

  /**
   * Удалить значение по пути.
   */
  delete(
    path: DataPathDef,
    opts?: { invalidate?: boolean; vars?: Record<string, any> },
  ): void {
    this._dataAdapter.delete(path, opts)
    this.notify(path, opts)
  }

  /**
   * Запускает цикл обновления по
   * заданному планировщику
   */
  startLoop(): void {
    if (this.__isLoopActive) return
    this.__isLoopActive = true

    const loop = (time: number): void => {
      if (!this.__isLoopActive) return

      this.invalidate()

      if (this._schedulerType === SchedulerType.AnimationFrame) {
        this.__animationFrameId = requestAnimationFrame(loop)
      } else {
        queueMicrotask(() => loop(performance.now()))
      }
    }

    loop(this.__lastTime)
  }

  /**
   * Остановить цикл обновления.
   */
  stopLoop(): void {
    this.__isLoopActive = false

    //
    this.__ups = 0
    if (this.__animationFrameId !== null) {
      cancelAnimationFrame(this.__animationFrameId)
      this.__animationFrameId = null
    }
    if (this.__upsResetTimeout !== null) {
      clearTimeout(this.__upsResetTimeout)
      this.__upsResetTimeout = null
    }

    //
    this.__eps = 0
    if (this.__epsResetTimeout !== null) {
      clearTimeout(this.__epsResetTimeout)
      this.__epsResetTimeout = null
    }

    //
    this.__nps = 0
    if (this.__npsResetTimeout !== null) {
      clearTimeout(this.__npsResetTimeout)
      this.__npsResetTimeout = null
    }

    //
    if (this.__throttleTimer !== null) {
      clearTimeout(this.__throttleTimer)
      this.__throttleTimer = null
    }
  }

  /**
   * Функция, которая помечает core, требующим обновления.
   * Однако обновления произойдет только, если есть грязные узлы.
   */
  invalidate(): void {
    if (this._schedulerPending) return

    this._schedulerPending = true
    this._scheduler(() => {
      this._schedulerPending = false
      this._scheduleRunThrottled()
    })
  }

  /**
   * Полная очистка RaphApp состояния
   */
  reset(): void {
    // Удаляем всех потомков _root-ноды

    // ToDo:

    this._nodeRouter.removeAll()
  }

  //
  // PRIVATE
  //

  /**
   * Зарегистрировать зависимость ноды от пути/маски.
   * dep может быть: строка ("rows[0].x"), DataPath или plain-JSON.
   * Возвращает стабильный ключ (бренд-строку), по которому хранится подписка.
   */
  track(
    node: RaphNode,
    mask: DataPathDef,
    opts?: {
      vars?: Record<string, any>
      wildcardDynamic?: boolean
    },
  ): void {
    const dp = DataPath.from(mask, opts)

    // console.log('[RAPH TRACK]')
    // console.log('Path:', dp.toStringPath())
    // console.log('Node:', node)
    this._nodeRouter.add(dp, node)
    Raph.events.emit('node:tracked', { node, path: dp.toStringPath() })
  }

  /**
   * Снять зависимость ноды. Если dep не передан — снимаем все зависимости ноды.
   */
  untrack(node: RaphNode, mask?: DataPathDef): void {
    if (!mask) {
      // Снимаем все зависимости
      this._nodeRouter.removePayload(node)
      return
    }

    this._nodeRouter.remove(mask, node)
  }

  //
  // PRIVATE
  //

  private _getPhaseDirty(phase: PhaseName): PhaseDirty {
    let q = this._dirty.get(phase)
    if (!q) {
      q = {
        buckets: new Map(),
        heap: new MinHeap(),
        inHeap: new Set(),
        events: new Map(),
      }
      this._dirty.set(phase, q)
    }
    return q
  }

  private _priority(node: RaphNode): number {
    // depth растёт - индекс растёт - обрабатываем раньше те, у кого depth меньше.
    // внутри одного depth: больший weight должен пойти раньше,
    // поэтому вычитаем weight (меньший индекс = выше приоритет).
    const depth = this._graph.getDepth(node)
    return depth * RaphApp.PRIORITY_SCALE - node.weight
  }

  //
  // GETTERS / SETTERS
  //

  get data(): DataObject {
    return this._dataAdapter.root()
  }

  get graph(): DepGraph {
    return this._graph
  }

  get loopEnabled(): boolean {
    return this.__isLoopActive
  }

  get ups(): number {
    return this.__ups
  }

  get eps(): number {
    return this.__eps
  }

  get nps(): number {
    return this.__nps
  }

  get maxUps(): number {
    return this._maxUps
  }

  get minUpdateInterval(): number {
    return this._minUpdateInterval
  }

  get dataAdapter(): DataAdapter {
    return this._dataAdapter
  }

  // Возвращает фазы в порядке исполнения
  get phases(): ReadonlyArray<RaphPhase> {
    return this._phasesArray
  }

  // Быстрый доступ к фазе по имени
  getPhase(name: PhaseName): RaphPhase | undefined {
    return this._phasesMap.get(name)
  }
}
