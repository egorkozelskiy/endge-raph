//
// Вспомогательное кодирование ключей для узла Trie
//
/**
 * Для узла - строка
 */
export function keyLiteralStr(k) {
    return 'S:' + k;
}
/**
 * Для узла - индекс массива
 */
export function keyIndex(n) {
    return 'I:' + n;
}
/**
 * Для узла - параметр (P:pk=#n:123 или P:pk=#s:abc)
 */
export function keyParam(pk, pv) {
    // учитываем тип значения (value и "value")
    return 'P:' + pk + '=' + (typeof pv === 'number' ? `#n:${pv}` : `#s:${pv}`);
}
//# sourceMappingURL=path.js.map