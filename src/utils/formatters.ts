/**
 * Format date to Randstad Brand standard: "DD Month YYYY" (e.g. 06 April 2026)
 */
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const formatDateRandstad = (dateInput: string | Date): string => {
  if (!dateInput) return 'N/A';
  try {
    // A bare "YYYY-MM-DD" is parsed by Date as UTC midnight, which renders as
    // the previous day in any negative-offset timezone. Read the parts directly.
    if (typeof dateInput === 'string') {
      const parts = dateInput.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (parts) {
        const monthIndex = Number(parts[2]) - 1;
        if (monthIndex >= 0 && monthIndex < 12) {
          return `${parts[3]} ${MONTH_NAMES[monthIndex]} ${parts[1]}`;
        }
      }
    }

    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return String(dateInput);

    const day = String(d.getDate()).padStart(2, '0');
    const month = d.toLocaleString('en-US', { month: 'long' });
    const year = d.getFullYear();
    return `${day} ${month} ${year}`;
  } catch {
    return String(dateInput);
  }
};

/**
 * Format month/year string to standard "Month YYYY" (e.g. "April 2026")
 */
export const formatMonthYear = (dateInput: string | Date): string => {
  if (!dateInput) return 'Unknown Month';
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return String(dateInput);
    return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  } catch {
    return String(dateInput);
  }
};

/**
 * Format currency according to Randstad guidelines: "USD $100.00"
 */
export const formatCurrencyRandstad = (amount: number, currencyCode: string = 'USD'): string => {
  if (isNaN(amount) || amount === null || amount === undefined) {
    return `${currencyCode} $0.00`;
  }
  const formattedNumber = amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currencyCode} $${formattedNumber}`;
};

/**
 * Format compact metric currency (e.g. USD $120.50)
 */
export const formatShortCurrency = (amount: number, currencyCode: string = 'USD'): string => {
  if (isNaN(amount)) return `${currencyCode} $0`;
  return `${currencyCode} $${amount.toFixed(2)}`;
};

/**
 * Format percentage drift (+12.5% or -3.2%)
 */
export const formatPercentageDrift = (percent: number): string => {
  if (isNaN(percent)) return '0.0%';
  const sign = percent > 0 ? '+' : '';
  return `${sign}${percent.toFixed(1)}%`;
};

/**
 * Oxford comma list joiner
 */
export const formatOxfordList = (items: string[]): string => {
  if (!items || items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
};

/**
 * Order regions the way the source file laid them out, so a pricing ladder
 * reads Base -> Mid -> Premium.
 *
 * `regionOrder` is the band position captured at ingest and is authoritative.
 * Average rate is only a fallback for records ingested before that existed (or
 * from non-regional files); it is not reliable on its own, because a role that
 * is absent from one tier skews that tier's mean and reorders the ladder.
 */
export const orderRegions = (
  records: { region?: string; regionOrder?: number; maxRate: number }[]
): string[] => {
  const stats = new Map<string, { order?: number; sum: number; count: number }>();

  for (const r of records) {
    const key = r.region || 'Unspecified';
    const entry = stats.get(key) ?? { order: undefined, sum: 0, count: 0 };
    if (typeof r.regionOrder === 'number') {
      entry.order = entry.order === undefined ? r.regionOrder : Math.min(entry.order, r.regionOrder);
    }
    entry.sum += r.maxRate;
    entry.count += 1;
    stats.set(key, entry);
  }

  return Array.from(stats.entries())
    .sort(([aName, a], [bName, b]) => {
      const aOrder = a.order ?? Number.POSITIVE_INFINITY;
      const bOrder = b.order ?? Number.POSITIVE_INFINITY;
      if (aOrder !== bOrder) return aOrder - bOrder;
      const aAvg = a.sum / (a.count || 1);
      const bAvg = b.sum / (b.count || 1);
      if (aAvg !== bAvg) return aAvg - bAvg;
      return aName.localeCompare(bName);
    })
    .map(([name]) => name);
};
