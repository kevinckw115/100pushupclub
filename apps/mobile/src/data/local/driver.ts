export type Parameter = string | number | null;
export interface SqlDriver {
  exec(sql: string): void;
  run(sql: string, ...parameters: Parameter[]): void;
  all<T>(sql: string, ...parameters: Parameter[]): T[];
  transaction<T>(work: () => T): T;
  close(): void;
}
