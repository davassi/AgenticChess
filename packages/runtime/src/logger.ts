export interface RuntimeLogger {
  info(meta: Record<string, unknown>, message: string): void;
  warn(meta: Record<string, unknown>, message: string): void;
  error(meta: Record<string, unknown>, message: string): void;
}

export const noopLogger: RuntimeLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
