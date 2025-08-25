//
// Узел trie: плоские объекты вместо Map ради скорости
//
// =====================
// Пример использования:
// =====================
// const r = new RaphRouter<RaphPayload>()
// r.add('com.*' as string as RaphPayload, 'P:1' as RaphPayload)
// r.add('a.*.c' as string as RaphPayload, 'P:2' as RaphPayload)
// r.add('com[id=7].x' as string as RaphPayload, 'P:3' as RaphPayload)
// r.add('arr[*].name' as string as RaphPayload, 'P:4' as RaphPayload)
//
// r.match('com.x.y')       // P:1
// r.match('a.b.c')         // P:2
// r.match('com[id=7].x')   // P:3
// r.match('arr[id=10].name') // P:4
import { keyParam } from '@/utils/path';
export class RouterNode {
    //
    // точные переходы по ключам и индексам
    exact = null;
    //
    // одиночный wildcard-сын
    wc = null;
    //
    // переходы по параметру: pk - (pv - node)
    param = null;
    //
    //
    paramAny = null;
    //
    // полезная нагрузка для точного окончания маршрута
    end = null;
    //
    // полезная нагрузка для глубокой маски ('*' на конце у предка)
    deep = null;
    //
    addExact(key) {
        const m = this.exact || (this.exact = Object.create(null));
        return (m[key] ||= new RouterNode());
    }
    addWildcard() {
        return (this.wc ||= new RouterNode());
    }
    addParam(pk, pv) {
        const pm = this.param || (this.param = Object.create(null));
        const bucket = (pm[pk] ||= Object.create(null));
        const k = keyParam(pk, pv);
        return (bucket[k] ||= new RouterNode());
    }
    addParamAny(pk, varName) {
        const m = this.paramAny || (this.paramAny = Object.create(null));
        if (!m[pk])
            m[pk] = { node: new RouterNode(), varName };
        return m[pk].node;
    }
    pushEnd(p) {
        ;
        (this.end || (this.end = new Set())).add(p);
    }
    pushDeep(p) {
        ;
        (this.deep || (this.deep = new Set())).add(p);
    }
}
//# sourceMappingURL=RaphRouterNode.js.map