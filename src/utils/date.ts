export function daysUntil(targetDate: string, fromDate = new Date()): number {
  const target = new Date(`${targetDate}T00:00:00Z`);
  const start = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), fromDate.getUTCDate()));
  const diffMs = target.getTime() - start.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}
