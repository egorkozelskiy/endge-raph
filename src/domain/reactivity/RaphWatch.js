//
//
import { RaphNode } from '@/domain/core/RaphNode';
export class RaphWatch extends RaphNode {
    _cb;
    constructor(app, id, masks, cb, weight = 0) {
        super(app, { id, weight, type: 'watch' });
        this._cb = cb;
        //
        // регистрируемся в графе и роутере путей:
        app.addNode(this);
        //
        // Подписываемся на все пути
        if (!Array.isArray(masks)) {
            masks = [masks];
        }
        for (const m of masks)
            app.track(this, m);
    }
    run(ctx) {
        this._cb({ events: ctx.events || [] });
    }
    /**
     * Снимает все подписки и удаляет узел
     */
    remove() {
        //
        // снять все маски
        this.app.untrack(this);
        //
        // убрать из графа
        this.app.removeNode(this);
    }
}
//# sourceMappingURL=RaphWatch.js.map