import { RaphNode } from '@/domain/core/RaphNode';
import { Raph } from '@/domain/core/Raph';
export class RaphSignal extends RaphNode {
    path;
    compute;
    /**
     * Текущий набор зависимостей (источников) для computed
     */
    _deps = new Set();
    //
    //
    constructor(app, id, path, compute) {
        super(app, { id, weight: 0, type: 'signal' });
        this.path = path;
        this.compute = compute;
        // регистрируем ноду в графе
        this.app.addNode(this);
        this.app.track(this, this.path);
        // для computed — сразу первичный расчёт, без уведомлений наружу
        if (this.compute) {
            this.update();
        }
    }
    /**
     * Прочтение значения (и возможная фиксация зависимости контекстной ноды от этого сигнала)
     */
    get value() {
        const current = Raph.currentNode;
        if (current) {
            if (current instanceof RaphSignal) {
                // вычисляется другой сигнал — строим ребро dep-this и подписку по пути
                current.addDependency(this);
            }
            else {
                // любая другая нода: достаточно подписки по пути
                this.app.track(current, this.path);
            }
        }
        return this.app.get(this.path);
    }
    /**
     * Запись значения (только для обычных сигналов)
     */
    set value(next) {
        if (this.compute) {
            throw new Error('Cannot assign to a computed signal.');
        }
        // обычный сигнал: запись + notify
        this.app.set(this.path, next);
    }
    /**
     * Пересчёт computed-сигнала. Без notify.
     */
    update() {
        if (!this.compute)
            return;
        // Снимаем старые зависимости (и из графа, и из роутера путей)
        if (this._deps.size) {
            for (const dep of this._deps) {
                this.app.removeDependency(dep, this);
                const depPath = dep.path;
                if (depPath)
                    this.app.untrack(this, depPath);
            }
            this._deps.clear();
        }
        // Выполняем вычисление под контекстом
        Raph.pushContext(this);
        let val;
        try {
            val = this.compute();
        }
        finally {
            Raph.popContext();
        }
        // Помещаем новое значение напрямую в хранилище (без лишних инвалидаций)
        this.app.dataAdapter.set(this.path, val);
    }
    /**
     * Зарегистрировать зависимость this от dep (dep - this)
     */
    addDependency(dep) {
        if (dep === this || this._deps.has(dep))
            return;
        this._deps.add(dep);
        // граф: ребро dep - this
        this.app.addDependency(dep, this);
        // роутер путей: чтобы notify по dep.path находил this как грязную
        const depPath = dep.path;
        if (depPath)
            this.app.track(this, depPath);
    }
}
//# sourceMappingURL=RaphSignal.js.map