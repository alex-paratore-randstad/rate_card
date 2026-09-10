/**
 * Shapes of the Domo datasets the app reads.
 *
 * These are external contracts, not app domain types — they mirror the
 * `datasetsMapping` field lists in `public/manifest.json` exactly. A dataset
 * read returns whatever the manifest declares, so the two must stay in step:
 * adding a column here without adding it there yields `undefined` at runtime,
 * and the reverse quietly ships a column no report uses.
 *
 * `assertRowShape` in datasetService checks the first row against these keys on
 * every read, because a manifest change needs a republish to take effect and
 * the drift is otherwise invisible until a number comes out wrong.
 */

/** Aliases as declared in the manifest. The read path addresses datasets by these. */
export const DATASET_ALIASES = {
  clientDirectory: 'rate_card_client_directory',
  assignmentActuals: 'rate_card_actuals_assignment',
  // rate_card_title_directory is not mapped yet — its dataflow has not run, so
  // no dataset id exists to map.
} as const;

export type DatasetAlias = (typeof DATASET_ALIASES)[keyof typeof DATASET_ALIASES];

/**
 * One candidate client as Domo knows it, from the client directory dataflow.
 *
 * Deliberately distinct from `ClientDirectoryEntry` in rateCard.ts: this is the
 * raw dataset row, that is the app's internal model. The read path maps between
 * them, which is the one place the column names appear.
 */
export interface ClientDirectoryRow {
  rsr_client_code: string;
  account_name: string;
  rsr_country: string;
  /** Total billable hours behind the account — materiality, not scoring input. */
  hours_sum: number;
  /** Latest reporting month seen, ISO date. */
  month_max: string;
}

/**
 * One assignment from the actuals dataflow, at one row per assignment.
 *
 * Rates are in `currency`, not normalized. Nothing may average across rows of
 * differing currency — see the note on `currency` below.
 */
export interface AssignmentActualRow {
  assignment_unique_key: string;
  /**
   * Rows behind this assignment in the source. Expected to be 1 at assignment
   * grain; anything higher means the source became a monthly snapshot and the
   * ETL's dedupe branch started doing real work.
   */
  snapshot_months: number;

  // --- client, joined to a confirmed alias on rsr_client_code ---
  rsr_client_code: string;
  account_name: string;

  // --- title, plus the ladder to fall back on when the exact title misses ---
  title_cleaned: string;
  ms_category_1: string;
  ms_category_2: string;
  soc_broad_group: string;
  onet_detailed_occupation: string;

  // --- dimensions the card is scoped by ---
  rsr_labor_type: string;
  contingent_vs_sow: string;
  collar_type: string;
  specialization: string;

  // --- geography: what makes a regional differential measured, not assumed ---
  rsr_country: string;
  state_province: string;
  city: string;
  market: string;
  rsr_region: string;

  // --- rates ---
  /** In `currency`, not normalized. Prefer a per-currency column for comparison. */
  pay_rate_st_hr: number;
  pay_rate_st_hr_initial: number;
  bill_rate_st_hr: number;

  /**
   * The same pay rate converted by the source's own FX rates.
   *
   * These are what make a card comparison correct: a card is priced in one
   * currency, and comparing it to a rate in another produces a violation that
   * is really an exchange rate. Null where the source had no rate to convert.
   */
  pay_rate_st_hr_usd: number | null;
  pay_rate_st_hr_cad: number | null;
  pay_rate_st_hr_eur: number | null;
  pay_rate_st_hr_gbp: number | null;
  pay_rate_st_hr_inr: number | null;
  /** The ceiling the VMS enforces, for reconciling against the uploaded card. */
  max_template_bill_rate_st_hr: number;
  /**
   * Domo's own compliance verdict. Typed as string on the assumption it is a
   * label rather than a flag — unverified until the first real read.
   */
  compliance_vs_max_template_bill_rate: string;

  // --- derived in the ETL rather than the browser ---
  /**
   * The card year in force when the assignment started, as text. It is a string
   * because the app's `rateYear` is parsed from a spreadsheet column header; an
   * integer here would not match on join, and would fail silently.
   */
  card_year: string;
  pay_drift: number;
  /** Null when the initial rate was zero or absent. */
  pay_drift_pct: number | null;
  /** Pre-multiplied rate x hours, so a weighted average is a division. */
  pay_dollars: number;
  bill_dollars: number;
  hours_to_date: number;

  /**
   * The currency the rates are in. Carried because nothing normalizes it: two
   * rows of differing currency describe different things, and any aggregate
   * must either scope to one currency or group by this column.
   */
  currency: string;

  // --- lifecycle ---
  assignment_status: string;
  /** 1 when the assignment has no end date or ends in the future. */
  is_open: number;
  /** 1 when the assignment ran past its original end date. */
  extended: number;

  // --- supplier ---
  rsr_supplier: string;
  preferred_supplier_status: string;
  supplier_category: string;
}

/** Columns expected in each dataset, for the read-time shape check. */
export const EXPECTED_COLUMNS: Record<DatasetAlias, string[]> = {
  [DATASET_ALIASES.clientDirectory]: [
    'rsr_client_code', 'account_name', 'rsr_country', 'hours_sum', 'month_max',
  ],
  [DATASET_ALIASES.assignmentActuals]: [
    'assignment_unique_key', 'snapshot_months',
    'rsr_client_code', 'account_name',
    'title_cleaned', 'ms_category_1', 'ms_category_2',
    'soc_broad_group', 'onet_detailed_occupation',
    'rsr_labor_type', 'contingent_vs_sow', 'collar_type', 'specialization',
    'rsr_country', 'state_province', 'city', 'market', 'rsr_region',
    'pay_rate_st_hr', 'pay_rate_st_hr_initial', 'bill_rate_st_hr',
    'pay_rate_st_hr_usd', 'pay_rate_st_hr_cad', 'pay_rate_st_hr_eur',
    'pay_rate_st_hr_gbp', 'pay_rate_st_hr_inr',
    'max_template_bill_rate_st_hr', 'compliance_vs_max_template_bill_rate',
    'card_year', 'pay_drift', 'pay_drift_pct',
    'pay_dollars', 'bill_dollars', 'hours_to_date',
    'currency',
    'assignment_status', 'is_open', 'extended',
    'rsr_supplier', 'preferred_supplier_status', 'supplier_category',
  ],
};

/**
 * Currencies the actuals carry a converted pay rate for.
 *
 * A card priced in anything else cannot be compared numerically, and the
 * report says so rather than falling back to USD — a silent currency
 * substitution turns an exchange rate into a compliance finding.
 */
export const CONVERTED_CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP', 'INR'] as const;

export type ConvertedCurrency = (typeof CONVERTED_CURRENCIES)[number];

/** The row field holding the pay rate in a given currency, or null if absent. */
export const payRateFieldFor = (
  currency: string
): keyof AssignmentActualRow | null => {
  const upper = (currency || '').trim().toUpperCase();
  return (CONVERTED_CURRENCIES as readonly string[]).includes(upper)
    ? (`pay_rate_st_hr_${upper.toLowerCase()}` as keyof AssignmentActualRow)
    : null;
};

/** Numeric columns per dataset. Domo may return these as strings. */
export const NUMERIC_COLUMNS: Record<DatasetAlias, string[]> = {
  [DATASET_ALIASES.clientDirectory]: ['hours_sum'],
  [DATASET_ALIASES.assignmentActuals]: [
    'snapshot_months',
    'pay_rate_st_hr', 'pay_rate_st_hr_initial', 'bill_rate_st_hr',
    'pay_rate_st_hr_usd', 'pay_rate_st_hr_cad', 'pay_rate_st_hr_eur',
    'pay_rate_st_hr_gbp', 'pay_rate_st_hr_inr',
    'max_template_bill_rate_st_hr',
    'pay_drift', 'pay_drift_pct',
    'pay_dollars', 'bill_dollars', 'hours_to_date',
    'is_open', 'extended',
  ],
};
