import { describe, expect, it } from 'vitest';
import {
  createFinancialProvenance,
  formatExactFinancialUsd,
  formatFinancialUsd,
  getRateFreshness,
} from '@/utils/financial-display';

describe('financial display helpers', () => {
  it('uses an explicit unavailable fallback for invalid financial values', () => {
    expect(formatFinancialUsd(undefined)).toBe('Unavailable');
    expect(formatFinancialUsd(null)).toBe('Unavailable');
    expect(formatFinancialUsd(Number.NaN)).toBe('Unavailable');
    expect(formatFinancialUsd(Number.POSITIVE_INFINITY)).toBe('Unavailable');
    expect(formatFinancialUsd(Number.NEGATIVE_INFINITY)).toBe('Unavailable');
  });

  it('preserves readable USD formatting for valid values', () => {
    expect(formatFinancialUsd(12.5)).toBe('$12.5');
    expect(formatFinancialUsd(12_500)).toBe('$12.5K');
    expect(formatFinancialUsd(2_500_000)).toBe('$2.50M');
    expect(formatFinancialUsd(3_450_000_000)).toBe('$3.45B');
    expect(formatFinancialUsd(1_200_000_000_000)).toBe('$1.20T');
  });

  it('formats negative values correctly with sign preceding dollar sign', () => {
    // Negative values should never format as "$-X" or skip compact abbreviations
    expect(formatFinancialUsd(-12.5)).toBe('-$12.5');
    expect(formatFinancialUsd(-500)).toBe('-$500');
    expect(formatFinancialUsd(-12_500)).toBe('-$12.5K');
    expect(formatFinancialUsd(-2_500_000)).toBe('-$2.50M');
    expect(formatFinancialUsd(-1_500_000_000)).toBe('-$1.50B');
  });

  it('treats zero and negative zero consistently without negative sign', () => {
    expect(formatFinancialUsd(0)).toBe('$0');
    expect(formatFinancialUsd(-0)).toBe('$0');
  });

  it('supports exact-balance display without compact abbreviations', () => {
    expect(formatFinancialUsd(12_500, { exact: true })).toBe('$12,500');
    expect(formatFinancialUsd(2_500_000, { compact: false })).toBe('$2,500,000');
    expect(formatExactFinancialUsd(12_500.5)).toBe('$12,500.5');
    expect(formatExactFinancialUsd(-12_500.75)).toBe('-$12,500.75');

    // Bigint exact balance support
    expect(formatExactFinancialUsd(1_000_000_000n)).toBe('$1,000,000,000');
    expect(formatExactFinancialUsd(-500_000n)).toBe('-$500,000');
  });

  it('respects decimal precision controls', () => {
    expect(formatFinancialUsd(12.3456, { decimals: 4 })).toBe('$12.3456');
    expect(formatFinancialUsd(12.3456, { decimals: 2 })).toBe('$12.35');
    expect(formatExactFinancialUsd(12500, { minimumFractionDigits: 2 })).toBe('$12,500.00');
    expect(formatExactFinancialUsd(12.5, { decimals: 3 })).toBe('$12.500');
  });

  it('adapts to locale changes', () => {
    // German uses period as thousands separator and comma as decimal separator
    const germanExact = formatFinancialUsd(12500.5, { exact: true, locale: 'de-DE' });
    expect(germanExact).toBe('$12.500,5');

    const germanNegativeExact = formatFinancialUsd(-12500.5, { exact: true, locale: 'de-DE' });
    expect(germanNegativeExact).toBe('-$12.500,5');

    const germanCompact = formatFinancialUsd(12500, { locale: 'de-DE' });
    expect(germanCompact).toBe('$12,5K');
  });

  it('protects against numeric overflow exceeding IEEE-754 safe integer bounds', () => {
    const overflowVal = Number.MAX_SAFE_INTEGER + 1000;
    expect(formatFinancialUsd(overflowVal)).toBe('Overflow');
    expect(formatFinancialUsd(-overflowVal)).toBe('Overflow');
    expect(formatFinancialUsd(1e25)).toBe('Overflow');
  });

  it('distinguishes fresh, stale, and unknown rate timestamps', () => {
    const now = 1_000_000;
    expect(getRateFreshness(now - 299_000, now, 300)).toBe('fresh');
    expect(getRateFreshness(now - 301_000, now, 300)).toBe('stale');
    expect(getRateFreshness(undefined, now, 300)).toBe('unknown');
    expect(getRateFreshness(now + 1, now, 300)).toBe('stale');
  });

  it('labels fallback and reference-rate provenance explicitly', () => {
    expect(createFinancialProvenance('fallback').label).toBe('Fallback value');
    expect(createFinancialProvenance('reference-rate').label).toBe('Reference-rate estimate');
  });
});
