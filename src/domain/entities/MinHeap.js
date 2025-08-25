// Мин-куча для чисел с минимальными аллокациями (дружественна к сборщику мусора).
export class MinHeap {
    //
    _a;
    _size;
    //
    constructor(initialCapacity = 0) {
        // Вместимость сохраняется и используется повторно между кадрами
        this._a = initialCapacity > 0 ? new Array(initialCapacity) : [];
        this._size = 0;
    }
    get size() {
        return this._size;
    }
    get empty() {
        return this._size === 0;
    }
    /**
     * Сохранять вместимость по умолчанию, чтобы избежать сборки мусора
     */
    clear(preserveCapacity = true) {
        if (preserveCapacity)
            this._size = 0;
        else {
            this._a.length = 0;
            this._size = 0;
        }
    }
    /**
     * Опциональная предварительная аллокация (не заполняет значения)
     */
    reserve(capacity) {
        if (capacity > this._a.length)
            this._a.length = capacity;
    }
    /**
     * Сохранять вместимость по умолчанию, чтобы избежать сборки мусора
     */
    peek() {
        return this._size === 0 ? undefined : this._a[0];
    }
    /**
     * Добавить один элемент (O(log n)), без аллокаций в устойчивом состоянии
     */
    push(x) {
        const i = this._size;
        if (i < this._a.length)
            this._a[i] = x;
        else
            this._a.push(x);
        this._size = i + 1;
        this._siftUp(i);
    }
    /**
     * Сохранять вместимость по умолчанию, чтобы избежать сборки мусора
     */
    pop() {
        const n = this._size;
        if (n === 0)
            return undefined;
        const a = this._a;
        const min = a[0];
        const last = a[n - 1];
        this._size = n - 1;
        if (this._size > 0) {
            a[0] = last;
            this._siftDown(0);
        }
        return min;
    }
    /**
     * Заменить верхний элемент и восстановить кучу (O(log n)); если пусто - добавить
     */
    replaceTop(x) {
        if (this._size === 0) {
            this.push(x);
            return undefined;
        }
        const min = this._a[0];
        this._a[0] = x;
        this._siftDown(0);
        return min;
    }
    /**
     * Построить кучу из массива за O(n) (копирует значения)
     */
    buildFrom(src) {
        const n = src.length;
        this._a.length = n;
        for (let i = 0; i < n; i++)
            this._a[i] = src[i];
        this._size = n;
        //
        // Построение кучи методом Флойда
        for (let i = (n >> 1) - 1; i >= 0; i--)
            this._siftDown(i);
    }
    /**
     * Внутренние методы (нерекурсивные, с минимальным ветвлением)
     */
    _siftUp(i) {
        const a = this._a;
        const x = a[i];
        while (i > 0) {
            const p = (i - 1) >> 1;
            const y = a[p];
            if (x >= y)
                break;
            a[i] = y;
            i = p;
        }
        a[i] = x;
    }
    _siftDown(i) {
        const a = this._a;
        const n = this._size;
        const x = a[i];
        const half = n >> 1; // узлы с минимум 1 потомком
        while (i < half) {
            const l = (i << 1) + 1;
            const r = l + 1;
            let child = l;
            let y = a[l];
            if (r < n) {
                const yr = a[r];
                if (yr < y) {
                    child = r;
                    y = yr;
                }
            }
            if (x <= y)
                break;
            a[i] = y;
            i = child;
        }
        a[i] = x;
    }
}
//# sourceMappingURL=MinHeap.js.map