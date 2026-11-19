export type FinancialDataSource = 'on-chain' | 'indexer' | 'reference-rate' | 'fallback';

export type RateFreshness = 'fresh' | 'stale' | 'unknown';

export interface FinancialProvenance {
  source: FinancialDataSource;
  label: string;
  updatedAt?: number;
  maxAgeSeconds?: number;
}

const SOURCE_LABELS: Record<FinancialDataSource, string> = {
  'on-chain': 'On-chain data',
  indexer: 'Indexer data',
  'reference-rate': 'Reference-rate estimate',
  fallback: 'Fallback value',
};

export function createFinancialProvenance(
  source: FinancialDataSource,
  updatedAt?: number,
  maxAgeSeconds?: number
): FinancialProvenance {
  return { source, label: SOURCE_LABELS[source], updatedAt, maxAgeSeconds };
}

export function getRateFreshness(
  updatedAt: number | undefined,
  now = Date.now(),
  maxAgeSeconds = 300
): RateFreshness {
  if (!Number.isFinite(updatedAt) || updatedAt === undefined) return 'unknown';
  if (updatedAt > now) return 'stale';
  return now - updatedAt <= maxAgeSeconds * 1000 ? 'fresh' : 'stale';
}

/**
 * Options controlling financial USD formatting.
 */
export interface FormatFinancialUsdOptions {
  /**
   * BCP 47 locale code (e.g. 'en-US', 'de-DE', 'fr-FR'). Defaults to 'en-US'.
   */
  locale?: string;
  /**
   * When true or when compact is false, displays exact un-abbreviated balance.
   */
  exact?: boolean;
  /**
   * Whether to abbreviate large amounts with K, M, B, T suffixes.
   * Defaults to true unless exact=true.
   */
  compact?: boolean;
  /**
   * Minimum fraction digits to display.
   */
  minimumFractionDigits?: number;
  /**
   * Maximum fraction digits to display.
   */
  maximumFractionDigits?: number;
  /**
   * Shorthand setting both minimum and maximum fraction digits to a fixed precision.
   */
  decimals?: number;
}

/**
 * Formats a monetary USD value for protocol display with support for:
 * - Negative values with correct accounting minus sign placement (`-$12.50` instead of `$-12.50`).
 * - Compact abbreviations (`K`, `M`, `B`, `T`) with negative handling (`-$12.5K`).
 * - Exact balance display (`options.exact = true` or `formatExactFinancialUsd`).
 * - Custom precision and decimal control (`options.decimals`, `maximumFractionDigits`, etc.).
 * - Locale-aware formatting (`options.locale`).
 * - IEEE-754 overflow prevention: numbers exceeding Number.MAX_SAFE_INTEGER return 'Overflow'.
 * - Non-finite, null, or undefined values return 'Unavailable'.
 *
 * @param value Number or bigint amount in USD.
 * @param options Display and formatting preferences.
 * @returns Formatted USD currency string.
 */
export function formatFinancialUsd(
  value: number | bigint | null | undefined,
  options?: FormatFinancialUsdOptions
): string {
  if (value === null || value === undefined) return 'Unavailable';

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'Unavailable';
    if (Math.abs(value) > Number.MAX_SAFE_INTEGER) return 'Overflow';
  }

  const locale = options?.locale ?? 'en-US';
  const isExact = options?.exact === true || options?.compact === false;

  // Determine negative state and treat negative zero as positive zero
  const isNegative = typeof value === 'bigint' ? value < 0n : value < 0 && !Object.is(value, -0);

  const sign = isNegative ? '-' : '';

  const minDigits = options?.decimals ?? options?.minimumFractionDigits;
  const rawMaxDigits = options?.decimals ?? options?.maximumFractionDigits;
  const maxDigits =
    rawMaxDigits !== undefined
      ? Math.max(rawMaxDigits, minDigits ?? 0)
      : minDigits !== undefined
        ? Math.max(minDigits, 2)
        : undefined;

  // Exact balance display mode: full precision without compact suffix
  if (isExact) {
    if (typeof value === 'bigint') {
      const absBig = value < 0n ? -value : value;
      const formatted = new Intl.NumberFormat(locale, {
        minimumFractionDigits: minDigits,
        maximumFractionDigits: maxDigits,
      }).format(absBig);
      return `${sign}$${formatted}`;
    }

    const absNum = Math.abs(value);
    const effectiveMaxDigits = maxDigits ?? (Number.isInteger(absNum) ? (minDigits ?? 0) : 2);
    const formatted = absNum.toLocaleString(locale, {
      minimumFractionDigits: minDigits,
      maximumFractionDigits: Math.max(effectiveMaxDigits, minDigits ?? 0),
    });
    return `${sign}$${formatted}`;
  }

  // Compact display mode (default)
  const absNum = typeof value === 'bigint' ? Number(value < 0n ? -value : value) : Math.abs(value);

  if (absNum >= 1_000_000_000_000) {
    const formatted = (absNum / 1_000_000_000_000).toLocaleString(locale, {
      minimumFractionDigits: minDigits ?? 2,
      maximumFractionDigits: maxDigits ?? 2,
    });
    return `${sign}$${formatted}T`;
  }

  if (absNum >= 1_000_000_000) {
    const formatted = (absNum / 1_000_000_000).toLocaleString(locale, {
      minimumFractionDigits: minDigits ?? 2,
      maximumFractionDigits: maxDigits ?? 2,
    });
    return `${sign}$${formatted}B`;
  }

  if (absNum >= 1_000_000) {
    const formatted = (absNum / 1_000_000).toLocaleString(locale, {
      minimumFractionDigits: minDigits ?? 2,
      maximumFractionDigits: maxDigits ?? 2,
    });
    return `${sign}$${formatted}M`;
  }

  if (absNum >= 1_000) {
    const formatted = (absNum / 1_000).toLocaleString(locale, {
      minimumFractionDigits: minDigits ?? 1,
      maximumFractionDigits: maxDigits ?? 1,
    });
    return `${sign}$${formatted}K`;
  }

  const effectiveMaxDigits = maxDigits ?? 2;
  const formatted = absNum.toLocaleString(locale, {
    minimumFractionDigits: minDigits,
    maximumFractionDigits: Math.max(effectiveMaxDigits, minDigits ?? 0),
  });
  return `${sign}$${formatted}`;
}

/**
 * Shorthand for exact-balance display without K/M/B/T abbreviation.
 */
export function formatExactFinancialUsd(
  value: number | bigint | null | undefined,
  options?: Omit<FormatFinancialUsdOptions, 'exact' | 'compact'>
): string {
  return formatFinancialUsd(value, { ...options, exact: true });
}
