import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
  ScaffoldDatabase,
  ScaffoldStatement,
  ScaffoldResult,
} from "../lib/scaffold-storage.ts";

/** Test adapter: real SQLite executes the generated D1 migration and queries. */
export class SqliteD1 implements ScaffoldDatabase {
  readonly database: DatabaseSync;

  constructor() {
    this.database = new DatabaseSync(":memory:");
    const directory = fileURLToPath(new URL("../drizzle/", import.meta.url));
    for (const filename of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) {
      this.database.exec(readFileSync(`${directory}/${filename}`, "utf8"));
    }
  }

  prepare(query: string): ScaffoldStatement {
    return new SqliteStatement(this.database, query, []);
  }

  close() {
    this.database.close();
  }
}

class SqliteStatement implements ScaffoldStatement {
  private readonly database: DatabaseSync;
  private readonly query: string;
  private readonly values: SQLInputValue[];

  constructor(database: DatabaseSync, query: string, values: SQLInputValue[]) {
    this.database = database;
    this.query = query;
    this.values = values;
  }

  bind(...values: (string | number | null)[]): ScaffoldStatement {
    return new SqliteStatement(this.database, this.query, values);
  }

  async first<Row>(): Promise<Row | null> {
    const row = this.database.prepare(this.query).get(...this.values);
    // D1 first<Row>() is also caller-typed; SQLite cannot derive a TS row type from SQL.
    return row === undefined ? null : row as Row;
  }

  async all<Row>(): Promise<ScaffoldResult<Row>> {
    const rows = this.database.prepare(this.query).all(...this.values);
    // The adapter mirrors D1's caller-typed result contract over actual SQLite rows.
    return { success: true, results: rows as Row[], meta: { changes: 0 } };
  }

  async run(): Promise<ScaffoldResult<never>> {
    const result = this.database.prepare(this.query).run(...this.values);
    return { success: true, results: [], meta: { changes: Number(result.changes) } };
  }
}
