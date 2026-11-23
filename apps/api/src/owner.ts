/**
 * The single place that decides who owns a request's data.
 * Single local user for now; real authentication plugs in here.
 */
export function getOwnerId(): string {
  return 'local';
}
