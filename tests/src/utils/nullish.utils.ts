/**
 * Checks if a given argument is null or undefined.
 *
 * @template T - The type of the argument.
 * @param {T | undefined | null} argument - The argument to check.
 * @returns {argument is undefined | null} `true` if the argument is null or undefined; otherwise, `false`.
 */
export const isNullish = <T>(argument: T | undefined | null): argument is undefined | null =>
  argument === null || argument === undefined;

/**
 * Checks if a given argument is neither null nor undefined.
 *
 * @template T - The type of the argument.
 * @param {T | undefined | null} argument - The argument to check.
 * @returns {argument is NonNullable<T>} `true` if the argument is not null or undefined; otherwise, `false`.
 */
export const nonNullish = <T>(argument: T | undefined | null): argument is NonNullable<T> =>
  !isNullish(argument);
