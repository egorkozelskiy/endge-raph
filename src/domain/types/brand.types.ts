/**
 * Модульный уникальный символ для брендов. Никогда не экспортируйте его значение напрямую.
 */
declare const __brand: unique symbol

/**
 * Маркер бренда.
 */
export type BrandTypes<B> = { readonly [__brand]: B }

/**
 * Делает номинальный (opaque) тип на основе базового структурного типа.
 * Пример: type UserId = Branded<string, 'UserId'>;
 */
export type Branded<T, B> = T & BrandTypes<B>

/**
 * Снятие бренда (если очень нужно выйти в базовый тип).
 */
export type Unbrand<T> = T extends Branded<infer U, any> ? U : never
