/**
 * Identifies a service in the container.
 *
 * Container identity is the token object itself, never the string id: the id is
 * only used in diagnostics. There is deliberately no global symbol registry, so
 * two independently created tokens with the same id stay distinct.
 *
 * @example
 * ```ts
 * export interface ProjectRepository {
 *   refresh(signal: AbortSignal): Promise<number>;
 * }
 *
 * export const ProjectRepository = serviceToken<ProjectRepository>('projects.repository');
 * ```
 */
export interface ServiceToken<T> {
  /** Human-readable id, used in errors, diagnostics and inspect output. */
  readonly id: string;
  /**
   * Phantom carrier for the service type. Never present at runtime.
   *
   * Declared as `() => T` so the token is covariant in `T`: that keeps
   * `ServiceToken<Concrete>` assignable to `ServiceToken<unknown>`, which the
   * dependency-map constraint relies on.
   */
  readonly resolves?: () => T;
}

/** Extracts the service type a token resolves to. */
export type ServiceOf<TToken> = TToken extends ServiceToken<infer T> ? T : never;

/** A named set of dependencies, declared up front so the graph can be validated. */
export type ServiceMap = Readonly<Record<string, ServiceToken<unknown>>>;

/**
 * The resolved form of a {@link ServiceMap}, handed to a factory or handler.
 *
 * @example
 * ```ts
 * type Deps = Injected<{ repository: typeof ProjectRepository }>;
 * // { readonly repository: ProjectRepository }
 * ```
 */
export type Injected<TMap extends ServiceMap> = {
  readonly [K in keyof TMap]: ServiceOf<TMap[K]>;
};

/**
 * Creates a service token.
 *
 * @example
 * ```ts
 * const Logger = serviceToken<Logger>('core.logger');
 * ```
 */
export function serviceToken<T>(id: string): ServiceToken<T> {
  // The phantom property is intentionally absent at runtime. Frozen because a
  // token is an identity the plan keys on: a mutated `id` would desynchronise
  // diagnostics from the graph preflight already validated.
  return Object.freeze({ id });
}
