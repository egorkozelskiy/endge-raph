import { describe, expect, it } from 'vitest'
import { SchedulerType } from '@/domain/types/base.types'
import { RaphNode } from '@/domain/core/RaphNode'
import { Raph } from '@/domain/core/Raph'
import { RaphRouter } from '@/domain/core/RaphRouter'

describe('RaphApp Base', () => {
  it('base', () => {
    //
    Raph.options({
      scheduler: SchedulerType.Sync,
    })

    const A = new RaphNode(Raph.app, { id: 'A', weight: 0 })
    const B = new RaphNode(Raph.app, { id: 'B', weight: 5 })

    Raph.app.addNode(A)
    Raph.app.addNode(B)
  })

  it('test', () => {
    //
    Raph.options({
      scheduler: SchedulerType.Sync,
    })

    // Raph.watch('*', () => {
    //   console.log('Watch *')
    // })
    // Raph.watch('FLT_ARR', () => {
    //   console.log('Watch FLT_ARR')
    // })
    Raph.watch('FLT_ARR.legs[id=$id].*', (p) => {
      console.log('Watch FLT_ARR.legs[*]')
      console.log(p)
    })
    // Raph.watch('FLT_ARR.legs[*].*', () => {
    //   console.log('Watch FLT_ARR.legs[*].*')
    // })

    Raph.set('FLT_ARR', {
      legs: [{ id: 1, name: 'first' }],
    })
    console.log('--------')
    Raph.set('FLT_ARR.legs[id=1].name', 'second')
  })

  function expectSetEqual<T>(set: Set<T>, arr: T[]): void {
    expect(set.size).toBe(arr.length)
    for (const v of arr) expect(set.has(v)).toBe(true)
  }

  it('matches exact keys', () => {
    const router = new RaphRouter()
    router.add('FLT_ARR.attrs[*].items[name="ArrivalModelType"].text[*]', 'H1')

    expectSetEqual(
      router.match('FLT_ARR.attrs[*].items[name="ArrivalModelType"].text'),
      ['H1'],
    )
  })
})
