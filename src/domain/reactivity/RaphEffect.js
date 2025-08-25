//
import { RaphNode } from '@/domain/core/RaphNode';
import { Raph } from '@/domain/core/Raph';
export class RaphEffect extends RaphNode {
    _fn;
    _cleanup;
    _stopped = false;
    constructor(app, fn, opts) {
        super(app, { id: opts.id, weight: opts.weight ?? 0, type: 'effect' });
        this._fn = fn;
        // Регистрируем в графе
        this.app.addNode(this);
        // Первая инициализация: либо сразу, либо через фазу
        if (opts.immediate ?? true) {
            this.run(); // выполнит fn под контекстом и подпишется на прочитанные пути
        }
    }
    /**
     * Выполнить эффект, пересобрав зависимости.
     */
    run() {
        if (this._stopped)
            return;
        // Снимаем прошлые подписки на пути
        this.app.untrack(this);
        // Вызываем cleanup прошлого запуска
        if (this._cleanup) {
            try {
                this._cleanup();
            }
            catch {
                // ToDo: ignore?
            }
            this._cleanup = undefined;
        }
        // Выполняем под контекстом — все чтения сигналов/данных подпишут эффект
        Raph.pushContext(this);
        let ret;
        try {
            ret = this._fn();
        }
        finally {
            Raph.popContext();
        }
        // Сохраняем cleanup, если вернули функцию
        if (typeof ret === 'function')
            this._cleanup = ret;
    }
    /**
     * Остановить эффект: снять подписки, вызвать cleanup и удалить из графа.
     */
    stop() {
        if (this._stopped)
            return;
        this._stopped = true;
        try {
            this._cleanup?.();
        }
        catch {
            // ToDo: ignore?
        }
        this._cleanup = undefined;
        this.app.untrack(this);
        this.app.removeNode(this);
    }
}
//# sourceMappingURL=RaphEffect.js.map