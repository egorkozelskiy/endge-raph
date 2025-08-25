import type { Branded } from '@/domain/types/brand.types'

/**
 * Бренд-тип для стабильного ключа точного пути (без wildcard)
 */
export type StableKey = Branded<string, 'StableKey'>

/**
 * Бренд-тип для стабильной маски (может содержать '*')
 */
export type StableMaskKey = Branded<string, 'StableMaskKey'>

/**
 * Внутренние коды сегментов для быстрого сравнения/ветвления
 */
export const enum SegKind {
  Key = 0, // объектный ключ: foo
  Index = 1, // индекс массива: [5]
  Wildcard = 2, // '*' — одиночный сегмент (или глубокий, если последний)
  Param = 3, // [k=v] — параметризованный доступ к элементу массива (ровно один параметр)
}

//
export type ParamValue = string | number

//
export interface DataPathSegment {
  //
  kind: SegKind

  // Для Key:
  key?: string

  // Для Index:
  index?: number

  // Для Wildcard:
  // - если сегмент последний и без параметров - deepWildcard=true
  deepWildcard?: boolean

  // Для Param:
  pkey?: string

  pval?: ParamValue
}
