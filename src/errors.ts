/**
 * Error with a translation code instead of a prebuilt message.
 * UI layers render it via t(`errors.${code}`, params); the raw
 * message still carries the code for logs.
 *
 * Kept free of TS parameter properties so Node can run dependent
 * modules directly in type-stripping mode.
 */
export class AppError extends Error {
  readonly code: string;
  readonly params?: Record<string, string | number>;

  constructor(code: string, params?: Record<string, string | number>) {
    super(code);
    this.name = 'AppError';
    this.code = code;
    this.params = params;
  }
}
