import { RaphApp } from '@/domain/core/RaphApp';
import { RaphSignal } from '@/domain/reactivity/RaphSignal';
import { RaphEffect } from '@/domain/reactivity/RaphEffect';
import { RaphWatch } from '@/domain/reactivity/RaphWatch';
import { DataPath } from '@/domain/entities/DataPath';
export class Raph {
    //
    // Core данные
    //
    static _app = new RaphApp();
    static _contextStack = [];
    //
    // Системные генераторы
    //
    static __signalId = 0;
    static __effectId = 0;
    static __watchId = 0;
    //
    // Инициализация
    //
    static {
        this.definePhases([]);
    }
    //
    // PUBLIC API
    //
    static options(opts) {
        this.app.options(opts);
    }
    static definePhases(phases) {
        this.app.definePhases([
            //
            // Фаза обработки computed значений
            //
            {
                name: '__computed',
                traversal: 'dirty-and-down',
                routes: ['__signals.*'],
                nodes: (node) => node instanceof RaphSignal,
                executor: (ctx) => {
                    ctx.node.update();
                },
            },
            //
            // Фаза обработки эффектов
            //
            {
                name: '__effects',
                traversal: 'dirty-only',
                routes: ['__signals.*'],
                nodes: (node) => node instanceof RaphEffect,
                executor: (ctx) => {
                    ctx.node.run();
                },
            },
            //
            // Фаза обработки watch
            //
            {
                name: '__watch',
                traversal: 'dirty-only',
                routes: ['*'],
                nodes: (node) => node instanceof RaphWatch,
                executor: (ctx) => {
                    ctx.node.run(ctx);
                },
            },
            //
            // Пользовательские фазы
            //
            ...phases,
        ]);
    }
    static signal(input) {
        const id = `__signals.${this.__signalId++}`;
        // если у тебя DataPath.fromString — оставь этот вызов;
        // если обычно используешь DataPath.from, замени на него.
        const path = DataPath.fromString(id);
        const compute = typeof input === 'function' ? input : undefined;
        // RaphSignal сам делает app.addNode(this) и (для computed) первый update()
        const sig = new RaphSignal(this._app, id, path, compute);
        if (!compute) {
            // задать стартовое значение без notify/dirty
            this._app.dataAdapter.set(path, input);
        }
        return sig;
    }
    static effect(fn, opts) {
        const id = `__effects.${this.__effectId++}`;
        const eff = new RaphEffect(this._app, fn, {
            id,
            weight: opts?.weight,
            immediate: opts?.immediate ?? true,
        });
        // Если immediate=false — добавим в очередь выбранной фазы,
        // чтобы эффект выполнился там и захватил зависимости.
        if (opts?.immediate === false) {
            this._app.dirty('__effects', eff);
        }
        // Вернём disposer
        return () => eff.stop();
    }
    /**
     * Подписка на один или несколько путей/масок.
     * Колбэк получает батч событий текущего тика.
     * Возвращает disposer.
     */
    static watch(maskOrMasks, cb, opts) {
        const masks = Array.isArray(maskOrMasks) ? maskOrMasks : [maskOrMasks];
        const id = `__watch.${this.__watchId++}`;
        const node = new RaphWatch(this._app, id, masks, cb, opts?.weight ?? 0);
        return () => node.remove();
    }
    /**
     * Получить значение по пути.
     */
    static get(path, opts) {
        return this.app.get(path, opts);
    }
    /**
     * Установить значение по пути.
     */
    static set(path, value, opts) {
        this.app.set(path, value, opts);
    }
    /**
     * Слияние значение по пути.
     */
    static merge(path, value, opts) {
        this.app.merge(path, value, opts);
    }
    /**
     * Удалить значение по пути.
     */
    static delete(path, opts) {
        this.app.delete(path, opts);
    }
    //
    // PRIVATE (STACK)
    //
    static get currentNode() {
        return this._contextStack[this._contextStack.length - 1];
    }
    static pushContext(node) {
        this._contextStack.push(node);
    }
    static popContext() {
        this._contextStack.pop();
    }
    //
    // ACCESS
    //
    static get app() {
        return Raph._app;
    }
    static get data() {
        return Raph.app.data;
    }
}
//# sourceMappingURL=Raph.js.map