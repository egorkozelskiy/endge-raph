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

//
import type { ParamValue } from '@/domain/types/path.types'
import { keyParam } from '@/utils/path'

type RouterNodeWithVarName = {
  node: RouterNode<any>
  varName: string
}

export class RouterNode<P> {
  //
  // точные переходы по ключам и индексам
  exact: Record<string, RouterNode<P>> | null = null

  //
  // одиночный wildcard-сын
  wc: RouterNode<P> | null = null

  //
  // переходы по параметру: pk - (pv - node)
  param: Record<string, Record<string, RouterNode<P>>> | null = null

  //
  //
  paramAny: Record<string, RouterNodeWithVarName> | null = null

  //
  // полезная нагрузка для точного окончания маршрута
  end: Set<P> | null = null

  //
  // полезная нагрузка для глубокой маски ('*' на конце у предка)
  deep: Set<P> | null = null

  //
  addExact(key: string): RouterNode<P> {
    const m = this.exact || (this.exact = Object.create(null))
    return (m[key] ||= new RouterNode<P>())
  }

  addWildcard(): RouterNode<P> {
    return (this.wc ||= new RouterNode<P>())
  }

  addParam(pk: string, pv: ParamValue): RouterNode<P> {
    const pm = this.param || (this.param = Object.create(null))
    const bucket = (pm[pk] ||= Object.create(null))
    const k = keyParam(pk, pv)
    return (bucket[k] ||= new RouterNode<P>())
  }

  addParamAny(pk: string, varName: string): RouterNode<P> {
    const m = this.paramAny || (this.paramAny = Object.create(null))
    if (!m[pk]) m[pk] = { node: new RouterNode<P>(), varName }
    return m[pk].node
  }

  pushEnd(p: P): void {
    ;(this.end || (this.end = new Set<P>())).add(p)
  }

  pushDeep(p: P): void {
    ;(this.deep || (this.deep = new Set<P>())).add(p)
  }
}
