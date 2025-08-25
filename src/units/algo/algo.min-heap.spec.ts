import { describe, it, expect } from 'vitest'
import { MinHeap } from '@/domain/entities/MinHeap'

// Детеминированный RNG (LCG), чтобы бенчи были воспроизводимыми
function makeLCG(seed = 123456789): any {
  let s = seed >>> 0
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0)
}

const N_SMALL = 5000

describe('MinHeap: функциональные тесты', () => {
  it('push/pop возвращают значения в неубывающем порядке', () => {
    const h = new MinHeap()
    const vals = [7, 1, 5, 2, 9, 3, 3, 0, -1, 10]
    for (const v of vals) h.push(v)

    const out: number[] = []
    while (!h.empty) out.push(h.pop()!)
    const sorted = [...vals].sort((a, b) => a - b)

    expect(out).toEqual(sorted)
    expect(h.size).toBe(0)
    expect(h.peek()).toBeUndefined()
  })

  it('peek не извлекает элемент', () => {
    const h = new MinHeap()
    h.push(3)
    h.push(1)
    h.push(2)

    expect(h.peek()).toBe(1)
    expect(h.size).toBe(3)
    expect(h.pop()).toBe(1)
    expect(h.peek()).toBe(2)
  })

  it('replaceTop заменяет минимум и восстанавливает кучу', () => {
    const h = new MinHeap()
    ;[5, 4, 3, 2, 1].forEach((x) => h.push(x))

    const prevMin = h.replaceTop(10)
    expect(prevMin).toBe(1)
    // теперь минимум должен быть 2
    expect(h.pop()).toBe(2)
    // остальное по порядку
    expect(h.pop()).toBe(3)
    expect(h.pop()).toBe(4)
    expect(h.pop()).toBe(5)
    expect(h.pop()).toBe(10)
    expect(h.pop()).toBeUndefined()
  })

  it('buildFrom строит кучу за O(n) и отдаёт отсортированный вывод', () => {
    const h = new MinHeap()
    const rng = makeLCG(42)
    const arr = Array.from({ length: N_SMALL }, () => rng() % 1_000_000 | 0)
    h.buildFrom(arr)

    const out: number[] = []
    while (!h.empty) out.push(h.pop()!)

    const sorted = [...arr].sort((a, b) => a - b)
    expect(out).toEqual(sorted)
  })

  it('поддерживает дубликаты', () => {
    const h = new MinHeap()
    h.push(5)
    h.push(5)
    h.push(5)
    expect(h.pop()).toBe(5)
    expect(h.pop()).toBe(5)
    expect(h.pop()).toBe(5)
    expect(h.pop()).toBeUndefined()
  })

  it('clear(preserveCapacity=true) обнуляет size, но сохраняет capacity', () => {
    const h = new MinHeap()
    // поднадуем внутренний буфер
    for (let i = 0; i < 100; i++) h.push(i)
    const capBefore = (h as any)._a.length

    h.clear(true)
    expect(h.size).toBe(0)
    // capacity должен сохраниться
    expect((h as any)._a.length).toBe(capBefore)

    // новый пуш не должен падать
    h.push(1)
    expect(h.size).toBe(1)
    expect(h.pop()).toBe(1)
  })

  it('clear(preserveCapacity=false) сбрасывает и размер, и capacity', () => {
    const h = new MinHeap()
    for (let i = 0; i < 50; i++) h.push(i)
    h.clear(false)
    expect(h.size).toBe(0)
    expect((h as any)._a.length).toBe(0)
  })

  it('reserve увеличивает capacity, но не меняет size', () => {
    const h = new MinHeap()
    h.reserve(256)
    expect((h as any)._a.length).toBeGreaterThanOrEqual(256)
    expect(h.size).toBe(0)

    // и вставка в пределах capacity проходит без проблем
    for (let i = 0; i < 128; i++) h.push(128 - i)
    expect(h.size).toBe(128)
  })

  it('рандом: поведение идентично сортировке', () => {
    const h = new MinHeap()
    const rng = makeLCG(1337)
    const data = Array.from({ length: N_SMALL }, () => rng() % 10_000 | 0)
    for (const x of data) h.push(x)
    const out: number[] = []
    while (!h.empty) out.push(h.pop()!)

    const sorted = [...data].sort((a, b) => a - b)
    expect(out).toEqual(sorted)
  })
})
