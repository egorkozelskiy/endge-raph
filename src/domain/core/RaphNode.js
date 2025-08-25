export class RaphNode {
    //
    // Системные
    //
    //
    _id;
    // тип узла, по умолчанию 'default'
    _type = 'default';
    //
    _app;
    // пользовательское значение приоритета обработки (на одном уровне)
    _weight = 0;
    // пользовательское значение приоритета обработки (на одном уровне)
    _meta = {};
    // Битовая маска с информацией, для какой фазы узел требует обработки
    __dirtyPhasesMask = 0;
    //
    static __nodeCounter = 0;
    //
    //
    constructor(app, opts) {
        this._app = app;
        this._id = `node-${RaphNode.__nodeCounter++}`;
        if (opts?.id) {
            this._id = opts.id;
        }
        if (opts?.weight) {
            this._weight = opts.weight;
        }
        if (opts?.meta) {
            this._meta = opts.meta;
        }
        if (opts?.type) {
            this._type = opts.type;
        }
    }
    //
    // PUBLIC API
    //
    /**
     * Очищает ноду и все ее потомки
     */
    addChild(node) {
        this._app.addNode(node);
        this._app.addDependency(this, node);
    }
    /**
     * Очищает ноду и все ее потомки
     */
    remove() {
        this._app.removeNode(this);
        this._weight = 0;
    }
    //
    // ACCESS
    //
    get app() {
        return this._app;
    }
    get id() {
        return this._id;
    }
    get weight() {
        return this._weight;
    }
    get meta() {
        return this._meta;
    }
    get type() {
        return this._type;
    }
}
//# sourceMappingURL=RaphNode.js.map