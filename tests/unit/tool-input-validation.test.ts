import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { daysUntil } from '../../src/utils/date.js';
import { normalizeDateInput, normalizePostcode } from '../../src/utils/normalize.js';
import { isFutureMonth, isValidLatitude, isValidLongitude } from '../../src/utils/validation.js';

describe('postcode normalization', () => {
  it('uppercases, trims, and collapses spaces', () => {
    expect(normalizePostcode(' sw1a  1aa ')).toBe('SW1A 1AA');
  });
});

describe('date validation', () => {
  it('validates latitude and longitude ranges', () => {
    expect(isValidLatitude(90)).toBe(true);
    expect(isValidLatitude(91)).toBe(false);
    expect(isValidLatitude(Number.NaN)).toBe(false);
    expect(isValidLongitude(-180)).toBe(true);
    expect(isValidLongitude(181)).toBe(false);
    expect(isValidLongitude(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('detects future months', () => {
    expect(isFutureMonth('2099-01')).toBe(true);
    expect(isFutureMonth('2000-01')).toBe(false);
    expect(isFutureMonth(undefined)).toBe(false);
  });

  it('normalizes YYYY-MM date inputs', () => {
    expect(normalizeDateInput(' 2026-01 ')).toBe('2026-01');
    expect(normalizeDateInput(undefined)).toBeUndefined();
    expect(() => normalizeDateInput('01-2026')).toThrow('Date must be in YYYY-MM format.');
  });

  it('computes whole days until a target date', () => {
    expect(daysUntil('2026-04-03', new Date('2026-04-01T12:00:00Z'))).toBe(2);
    expect(daysUntil('2026-04-01', new Date('2026-04-01T12:00:00Z'))).toBe(0);
  });
});

describe('schema validation', () => {
  it('rejects invalid latitude and longitude values with Zod', () => {
    const latSchema = z.number().refine(isValidLatitude, 'Latitude must be between -90 and 90.');
    const lonSchema = z.number().refine(isValidLongitude, 'Longitude must be between -180 and 180.');

    expect(() => latSchema.parse(91)).toThrow();
    expect(() => lonSchema.parse(181)).toThrow();
    expect(latSchema.parse(-90)).toBe(-90);
    expect(lonSchema.parse(0)).toBe(0);
  });
});
