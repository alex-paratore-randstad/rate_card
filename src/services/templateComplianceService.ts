import { AssignmentActualRow } from '../types/domoDatasets';
import { ClientAlias, RateCardRecord, TitleAlias } from '../types/rateCard';
import { countryKey } from './countryService';
import { resolveScope } from './scopeService';

/**
 * Bill rate against the ceiling the VMS itself enforces.
 *
 * Independent of the uploaded rate card. `bill_rate_st_hr` and
 * `max_template_bill_rate_st_hr` are both bill-side and both sit on the same
 * row in the same currency, so the comparison needs no conversion and no title
 * matching — which makes this the one check that works before any of that is
 * done, and for clients with no card at all.
 *
 * Only money totals are currency-bound: a verdict is intra-row and therefore
 * always valid, but adding excess across currencies is meaningless, so the
 * money is reported per currency and never summed across them.
 *
 * The source carries its own verdict in `compliance_vs_max_template_bill_rate`.
 * That column is cross-checked rather than trusted or ignored: agreement is
 * evidence both are right, and disagreement is a finding about one of them.
 */

export type TemplateVerdict =
  /** Bill rate exceeds the template ceiling. */
  | 'over'
  | 'within'
  /** No ceiling configured, so nothing to judge against. */
  | 'no-ceiling'
  /** No bill rate recorded. */
  | 'no-rate';

export interface TemplateAssignment {
  assignmentKey: string;
  clientCode: string;
  accountName: string;
  title: string;
  supplier?: string;
  preferredStatus?: string;
  stateProvince?: string;
  billRate: number;
  templateMax: number;
  currency: string;
  hours: number;
  verdict: TemplateVerdict;
  /** (bill - ceiling) x hours, in `currency`. Zero unless over. */
  excessAmount: number;
  isOpen: boolean;
  /** The source's own verdict, verbatim. */
  sourceVerdict?: string;
}

export interface TemplateCurrencyTotals {
  currency: string;
  assignments: number;
  hours: number;
  hoursOver: number;
  excessAmount: number;
  openExcessAmount: number;
}

export interface TemplateClientRow {
  clientCode: string;
  accountName: string;
  currency: string;
  assignments: number;
  hours: number;
  hoursOver: number;
  hoursNoCeiling: number;
  excessAmount: number;
  overShare: number | null;
}

/**
 * How the source's own verdict compares to the one computed here.
 *
 * `sourceValues` exists because the column's value domain is unknown — it is
 * reported rather than assumed, so an unrecognised vocabulary shows up as
 * unrecognised instead of being silently read as agreement.
 */
export interface TemplateCrossCheck {
  compared: number;
  agree: number;
  disagree: number;
  /** Rows whose source verdict could not be interpreted. */
  uninterpreted: number;
  /** Distinct values seen, with counts, most common first. */
  sourceValues: { value: string; count: number }[];
  /** Interpretation applied to each value, for the reader to sanity-check. */
  interpretation: { value: string; readAs: 'over' | 'within' | 'unrecognised' }[];
}

export interface TemplateComplianceReport {
  rateYear: string;
  availableYears: string[];
  scopedToCardClients: boolean;
  totals: {
    assignments: number;
    hours: number;
    hoursOver: number;
    hoursWithin: number;
    hoursNoCeiling: number;
    /** Share of judgeable hours over the ceiling, 0 to 1. */
    overShare: number | null;
    /** Share of hours with no ceiling configured at all. */
    noCeilingShare: number | null;
  };
  byCurrency: TemplateCurrencyTotals[];
  clients: TemplateClientRow[];
  worst: TemplateAssignment[];
  crossCheck: TemplateCrossCheck;
  excluded: { reason: string; count: number }[];
}

/**
 * Read the source's verdict without assuming its vocabulary.
 *
 * Deliberately checks "non-compliant" before "compliant": the negative form
 * contains the positive one as a substring, and testing the other way round
 * would read every violation as a pass.
 */
const interpretSourceVerdict = (raw: string): 'over' | 'within' | 'unrecognised' => {
  const v = (raw || '').trim().toLowerCase();
  if (!v) return 'unrecognised';
  if (/non.?compliant|not.?compliant|over|exceed|above|breach|fail|^n$|^no$|^0$|^false$/.test(v)) {
    return 'over';
  }
  if (/compliant|within|under|below|at.?or.?under|pass|^y$|^yes$|^1$|^true$/.test(v)) {
    return 'within';
  }
  return 'unrecognised';
};

export const buildTemplateComplianceReport = (
  cards: RateCardRecord[],
  actuals: AssignmentActualRow[],
  clientAliases: ClientAlias[],
  titleAliases: TitleAlias[] = [],
  options: { rateYear?: string; allClients?: boolean } = {}
): TemplateComplianceReport => {
  const scope = resolveScope(cards, clientAliases, titleAliases, options.rateYear);
  const allClients = options.allClients === true;

  const assignments: TemplateAssignment[] = [];
  const exclusionTally = new Map<string, number>();
  const exclude = (reason: string) =>
    exclusionTally.set(reason, (exclusionTally.get(reason) ?? 0) + 1);

  const sourceCounts = new Map<string, number>();

  for (const row of actuals) {
    const clientCode = (row.rsr_client_code || '').trim();

    if (!allClients) {
      if (!clientCode || !scope.clientLabels.has(clientCode)) {
        exclude('client has no rate card in scope');
        continue;
      }
      if (!scope.scopeKeys.has(`${clientCode}||${countryKey(row.rsr_country || '')}`)) {
        exclude('country not in scope');
        continue;
      }
    } else if (!clientCode) {
      exclude('no client code');
      continue;
    }

    if (scope.rateYear && (row.card_year || '') !== scope.rateYear) {
      exclude('card year does not match');
      continue;
    }

    const hours = typeof row.hours_to_date === 'number' ? row.hours_to_date : 0;
    if (hours <= 0) {
      exclude('no hours recorded yet');
      continue;
    }

    const billRate = typeof row.bill_rate_st_hr === 'number' ? row.bill_rate_st_hr : 0;
    const templateMax =
      typeof row.max_template_bill_rate_st_hr === 'number' ? row.max_template_bill_rate_st_hr : 0;

    const verdict: TemplateVerdict =
      billRate <= 0
        ? 'no-rate'
        : templateMax <= 0
        ? 'no-ceiling'
        : billRate > templateMax
        ? 'over'
        : 'within';

    const sourceVerdict = (row.compliance_vs_max_template_bill_rate || '').trim() || undefined;
    if (sourceVerdict) {
      sourceCounts.set(sourceVerdict, (sourceCounts.get(sourceVerdict) ?? 0) + 1);
    }

    assignments.push({
      assignmentKey: row.assignment_unique_key,
      clientCode,
      accountName: row.account_name || clientCode,
      title: row.title_cleaned || '(no title)',
      supplier: row.rsr_supplier || undefined,
      preferredStatus: row.preferred_supplier_status || undefined,
      stateProvince: row.state_province || undefined,
      billRate,
      templateMax,
      // The row's own currency: both sides of the comparison are in it, so no
      // conversion is needed for the verdict.
      currency: row.currency || '',
      hours,
      verdict,
      excessAmount: verdict === 'over' ? (billRate - templateMax) * hours : 0,
      isOpen: row.is_open === 1,
      sourceVerdict,
    });
  }

  // --- totals, hours-based and therefore currency-free ---------------------
  const hoursOver = assignments.filter((a) => a.verdict === 'over').reduce((s, a) => s + a.hours, 0);
  const hoursWithin = assignments
    .filter((a) => a.verdict === 'within')
    .reduce((s, a) => s + a.hours, 0);
  const hoursNoCeiling = assignments
    .filter((a) => a.verdict === 'no-ceiling' || a.verdict === 'no-rate')
    .reduce((s, a) => s + a.hours, 0);
  const judgeable = hoursOver + hoursWithin;
  const totalHours = judgeable + hoursNoCeiling;

  // --- money, per currency and never across ------------------------------
  const currencyMap = new Map<string, TemplateCurrencyTotals>();
  for (const a of assignments) {
    const key = a.currency || 'unknown';
    let agg = currencyMap.get(key);
    if (!agg) {
      agg = { currency: key, assignments: 0, hours: 0, hoursOver: 0, excessAmount: 0, openExcessAmount: 0 };
      currencyMap.set(key, agg);
    }
    agg.assignments += 1;
    agg.hours += a.hours;
    if (a.verdict === 'over') {
      agg.hoursOver += a.hours;
      agg.excessAmount += a.excessAmount;
      if (a.isOpen) agg.openExcessAmount += a.excessAmount;
    }
  }

  // --- per client ---------------------------------------------------------
  const clientMap = new Map<string, TemplateClientRow>();
  for (const a of assignments) {
    let row = clientMap.get(a.clientCode);
    if (!row) {
      row = {
        clientCode: a.clientCode,
        accountName: a.accountName,
        currency: a.currency,
        assignments: 0,
        hours: 0,
        hoursOver: 0,
        hoursNoCeiling: 0,
        excessAmount: 0,
        overShare: null,
      };
      clientMap.set(a.clientCode, row);
    }
    row.assignments += 1;
    row.hours += a.hours;
    if (a.verdict === 'over') {
      row.hoursOver += a.hours;
      row.excessAmount += a.excessAmount;
    } else if (a.verdict === 'no-ceiling' || a.verdict === 'no-rate') {
      row.hoursNoCeiling += a.hours;
    }
  }
  const clients = Array.from(clientMap.values()).map((row) => {
    const judged = row.hours - row.hoursNoCeiling;
    return { ...row, overShare: judged > 0 ? row.hoursOver / judged : null };
  });
  clients.sort((a, b) => b.excessAmount - a.excessAmount || b.hoursOver - a.hoursOver);

  // --- cross-check against the source's own verdict -----------------------
  const interpretation = Array.from(sourceCounts.keys())
    .sort()
    .map((value) => ({ value, readAs: interpretSourceVerdict(value) }));
  const readAs = new Map(interpretation.map((i) => [i.value, i.readAs]));

  let compared = 0;
  let agree = 0;
  let disagree = 0;
  let uninterpreted = 0;
  for (const a of assignments) {
    if (a.verdict !== 'over' && a.verdict !== 'within') continue;
    if (!a.sourceVerdict) continue;
    const theirs = readAs.get(a.sourceVerdict) ?? 'unrecognised';
    if (theirs === 'unrecognised') {
      uninterpreted += 1;
      continue;
    }
    compared += 1;
    if (theirs === a.verdict) agree += 1;
    else disagree += 1;
  }

  return {
    rateYear: scope.rateYear,
    availableYears: scope.availableYears,
    scopedToCardClients: !allClients,
    totals: {
      assignments: assignments.length,
      hours: totalHours,
      hoursOver,
      hoursWithin,
      hoursNoCeiling,
      overShare: judgeable > 0 ? hoursOver / judgeable : null,
      noCeilingShare: totalHours > 0 ? hoursNoCeiling / totalHours : null,
    },
    byCurrency: Array.from(currencyMap.values()).sort((a, b) => b.hours - a.hours),
    clients,
    worst: assignments
      .filter((a) => a.verdict === 'over')
      .sort((a, b) => b.excessAmount - a.excessAmount)
      .slice(0, 50),
    crossCheck: {
      compared,
      agree,
      disagree,
      uninterpreted,
      sourceValues: Array.from(sourceCounts, ([value, count]) => ({ value, count })).sort(
        (a, b) => b.count - a.count
      ),
      interpretation,
    },
    excluded: Array.from(exclusionTally, ([reason, count]) => ({ reason, count })).sort(
      (a, b) => b.count - a.count
    ),
  };
};
