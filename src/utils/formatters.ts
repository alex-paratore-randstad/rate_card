/**
 * Format date to Randstad Brand standard: "DD Month YYYY" (e.g. 06 April 2026)
 */
export const formatDateRandstad = (dateInput: string | Date): string => {
  if (!dateInput) return 'N/A';
  try {
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
