export function isValidLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

export function isFutureMonth(value?: string): boolean {
  if (!value) return false;
  const [year, month] = value.split('-').map(Number);
  const now = new Date();
  const currentDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const targetDate = new Date(Date.UTC(year, month - 1, 1));
  return targetDate > currentDate;
}
