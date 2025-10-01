/**
 * Тип колбэка для события.
 * @template T Тип данных, передаваемых в событие.
 */
type EventCallback<T = any> = (payload: T) => void

/**
 * EventBus реализует паттерн подписки на события.
 *
 * Поддерживает:
 * - Типизированные события через дженерик StaticEvents;
 * - Кастомные (непредопределённые) события;
 * - Подписку `on`, одноразовую подписку `once`, отписку `off`;
 * - Эмит `emit`, проверку `hasListeners` и список активных событий `eventNames`.
 *
 * Пример использования:
 *
 * ```ts
 * type Events = {
 *   userLogin: { id: string }
 *   error: { message: string }
 * }
 *
 * const bus = new EventBus<Events>(['userLogin', 'error'])
 *
 * bus.on('userLogin', ({ id }) => console.log(`Login: ${id}`))
 * bus.once('error', ({ message }) => console.warn('One-time error:', message))
 *
 * bus.emit('userLogin', { id: 'u42' })         // Login: u42
 * bus.emit('error', { message: 'fail' })       // One-time error: fail
 * bus.emit('error', { message: 'fail again' }) // уже не сработает
 *
 * console.log(bus.hasListeners('userLogin')) // true
 * console.log(bus.eventNames())              // ['userLogin']
 * ```
 */
export class EventBus<StaticEvents extends Record<string, any> = {}> {
  private listeners: Map<string, Set<EventCallback>> = new Map()

  /**
   * @param predefinedEvents Предопределённые события, для которых заранее создаются записи в карте.
   */
  constructor(private predefinedEvents: (keyof StaticEvents)[] = []) {
    predefinedEvents.forEach((event) => {
      this.listeners.set(event as string, new Set())
    })
  }

  /**
   * Подписка на событие.
   *
   * @template K Название события.
   * @param event Название события.
   * @param callback Обработчик события.
   */
  on<K extends keyof StaticEvents>(
    event: K,
    callback: EventCallback<StaticEvents[K]>,
  ): void
  on(event: string, callback: EventCallback): void
  on(event: string, callback: EventCallback): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(callback)
  }

  /**
   * Одноразовая подписка. Автоматически удаляет слушателя после первого вызова.
   *
   * @template K Название события.
   * @param event Название события.
   * @param callback Обработчик события.
   */
  once<K extends keyof StaticEvents>(
    event: K,
    callback: EventCallback<StaticEvents[K]>,
  ): void
  once(event: string, callback: EventCallback): void
  once(event: string, callback: EventCallback): void {
    const wrapper = (payload: any) => {
      this.off(event, wrapper)
      callback(payload)
    }
    this.on(event, wrapper)
  }

  /**
   * Отписка от события.
   *
   * @template K Название события.
   * @param event Название события.
   * @param callback Обработчик, который необходимо удалить.
   */
  off<K extends keyof StaticEvents>(
    event: K,
    callback: EventCallback<StaticEvents[K]>,
  ): void
  off(event: string, callback: EventCallback): void
  off(event: string, callback: EventCallback): void {
    this.listeners.get(event)?.delete(callback)
  }

  /**
   * Вызов события. Все подписчики получат переданные данные.
   *
   * @template K Название события.
   * @param event Название события.
   * @param payload Данные, передаваемые подписчикам.
   */
  emit<K extends keyof StaticEvents>(event: K, payload: StaticEvents[K]): void
  emit(event: string, payload?: any): void
  emit(event: string, payload?: any): void {
    const callbacks = this.listeners.get(event)
    if (!callbacks) return
    for (const cb of callbacks) {
      cb(payload)
    }
  }

  /**
   * Проверяет, есть ли слушатели у события.
   *
   * @param event Название события.
   * @returns true, если есть хотя бы один подписчик.
   */
  hasListeners(event: string): boolean {
    return (this.listeners.get(event)?.size ?? 0) > 0
  }

  /**
   * Возвращает список всех событий, на которые есть хотя бы один подписчик.
   *
   * @returns Массив названий событий.
   */
  eventNames(): string[] {
    return [...this.listeners.entries()]
      .filter(([, set]) => set.size > 0)
      .map(([event]) => event)
  }

  /**
   * Очистка слушателей:
   * - Если передано имя события — очищаются только слушатели этого события;
   * - Если аргумент не передан — очищаются все события.
   *
   * @param event (опционально) Название события для очистки.
   */
  clear(event?: string): void {
    if (event) {
      this.listeners.get(event)?.clear()
    } else {
      this.listeners.clear()
    }
  }
}

// Универсальный EventBus для глобальных событий приложения
export type GlobalEvents = {
  // Единая точка всех ассинхронных сообщения (toast)
  notify: {
    severity: 'success' | 'error' | 'info' | 'warn'
    summary: string
    detail?: string
    life?: number
  }
  // Также можно использовать любые произвольные события
}

export const AppBus = new EventBus<GlobalEvents>(
  Object.keys({} as GlobalEvents) as (keyof GlobalEvents)[],
)
