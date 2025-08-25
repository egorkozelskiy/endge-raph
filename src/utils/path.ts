//
// Вспомогательное кодирование ключей для узла Trie
//

import type { ParamValue } from '@/domain/types/path.types'

/**
 * Для узла - строка
 */
export function keyLiteralStr(k: string): string {
  return 'S:' + k
}

/**
 * Для узла - индекс массива
 */
export function keyIndex(n: number): string {
  return 'I:' + n
}

/**
 * Для узла - параметр (P:pk=#n:123 или P:pk=#s:abc)
 */
export function keyParam(pk: string, pv: ParamValue): string {
  // учитываем тип значения (value и "value")
  return 'P:' + pk + '=' + (typeof pv === 'number' ? `#n:${pv}` : `#s:${pv}`)
}
