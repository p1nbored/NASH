// Orca's reset deletes tasks and dispatches but not the app's side rows, so a side row whose Orca
// row is gone reads as orphaned (0 or 1 in SQL) instead of silently continuing. The arguments are
// column expressions written by the stores, never user input.

/** True when Orca no longer holds the task, or holds it under another run. */
export function taskOrphanedSql(taskIdColumn: string, runIdColumn: string | null = null): string {
  const sameRun = runIdColumn === null ? '' : ` AND orca_task.run_id = ${runIdColumn}`
  return `NOT EXISTS (SELECT 1 FROM tasks orca_task WHERE orca_task.id = ${taskIdColumn}${sameRun})`
}

/** True when Orca no longer holds the dispatch, which is the attempt's identity. */
export function dispatchOrphanedSql(dispatchIdColumn: string): string {
  return `NOT EXISTS (SELECT 1 FROM dispatch_contexts orca_dispatch WHERE orca_dispatch.id = ${dispatchIdColumn})`
}
