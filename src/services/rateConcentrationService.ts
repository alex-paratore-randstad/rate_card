import { AssignmentActualRow } from '../types/domoDatasets';
import { ClientAlias, RateCardRecord, TitleAlias, TitleMapping } from '../types/rateCard';
import { clientCodeFor } from './clientMatchService';
import { countryKey } from './countryService';
import { pairLines } from './rateMovementService';
import { normalizeJobTitle } from './titleService';
import { actualTitleKeyFor } from './titleMatchService';

/**
 * Where the cost of a rate change concentrates: each role's change in the card
 * maximum against the spend behind it.
 *
 * The change comes from the uploaded cards, paired line by line exactly as the
 * movement report pairs them. The spend comes from the Domo actuals, joined on
 * client code, country, and title through the same confirmed client and title
 * matches the coverage report uses — so a role's spend here is the spend that
 * report counts as governed by the card, and the two cannot disagree.
 *
 * Spend is `bill_dollars` — bill rate times hours to date — converted to USD.
 * The actuals carry no converted bill amount, but they carry the source's own
 * USD conversion of the pay rate, and the ratio of the two is that row's
 * exchange rate. A row with neither a USD currency nor a conversion is left
 * out and counted, never summed at its local value.
 *
 * Spend to date is not trailing-twelve-month spend: the dataset is one row per
 * assignment with no reporting month, so it cannot be windowed. A role with a
 * long-running assignment carries its whole history.
 */

export interface RoleBubble {
  role: string;
  /** Spend-weighted change in the card maximum, percent. */
  change: number;
  /** USD. */
  spend: number;
  /** Assignments still open — the workers the new rate would apply to first. */
  activeWorkers: number;
  /** spend x change: what the same work would cost more at the new maximum. */
  impact: number;
  /** Card lines behind the role, in both years. */
  lines: number;
}

export interface Concentration {
  fromYear: string;
  toYear: string;
  /** Roles with spend, which are the ones plotted. */
  roles: RoleBubble[];
  /** Spend-weighted change across every plotted role. */
  portfolioChange: number;
  /** Median role spend: the line above which a role is material. */
  spendThreshold: number;
  /** Above both lines, largest impact first. */
  watchList: RoleBubble[];
  watchImpact: number;
  /** Net impact across every plotted role. */
  totalImpact: number;
  totalSpend: number;
  /** Card roles that moved but matched no spend; not plotted. */
  rolesWithoutSpend: string[];
  /** Actuals in the scope's clients and countries that joined to no card line. */
  unmatchedSpend: number;
  excluded: { reason: string; count: number }[];
  unresolvedClients: string[];
}

/** The rate to multiply a row's local amount by to get USD, or null. */
const usdFactor = (row: AssignmentActualRow): number | null => {
  if ((row.currency || '').trim().toUpperCase() === 'USD') return 1;
  const local = row.pay_rate_st_hr;
  const usd = row.pay_rate_st_hr_usd;
  return typeof usd === 'number' && typeof local === 'number' && usd > 0 && local > 0
    ? usd / local
    : null;
};

const median = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export const computeConcentration = (
  records: RateCardRecord[],
  fromYear: string,
  toYear: string,
  mappings: TitleMapping[],
  actuals: AssignmentActualRow[],
  clientAliases: ClientAlias[],
  titleAliases: TitleAlias[]
): Concentration => {
  const byKey = new Map(mappings.map((m) => [m.uploadedTitleKey, m]));
  const roleFor = (title: string) => byKey.get(normalizeJobTitle(title))?.standardTitle || title;

  // --- the card side: one change per join key ------------------------------
  // Several card lines can share a join key — a labor type split, or two card
  // titles matched to one actuals title. Their changes are averaged, since the
  // actuals cannot say which of them an assignment fell under.
  const joins = new Map<string, { role: string; sum: number; lines: number }>();
  const scopeKeys = new Set<string>();
  const unresolved = new Set<string>();

  for (const { record, change } of pairLines(records, fromYear, toYear).lines) {
    const client = (record.client || '').trim();
    const code = clientCodeFor(client, clientAliases);
    if (!code) {
      if (client) unresolved.add(client);
      continue;
    }
    const country = countryKey(record.country || '');
    scopeKeys.add(`${code}||${country}`);
    const titleKey =
      actualTitleKeyFor(code, record.jobTitle, titleAliases) ?? normalizeJobTitle(record.jobTitle);
    const key = `${code}||${country}||${titleKey}`;
    const entry = joins.get(key) ?? { role: roleFor(record.jobTitle), sum: 0, lines: 0 };
    entry.sum += change;
    entry.lines += 1;
    joins.set(key, entry);
  }

  // --- the actuals side: spend and open assignments per join key ------------
  const spendByKey = new Map<string, { spend: number; active: number }>();
  const tally = new Map<string, number>();
  const exclude = (reason: string) => tally.set(reason, (tally.get(reason) ?? 0) + 1);
  let unmatchedSpend = 0;

  for (const row of actuals) {
    const code = (row.rsr_client_code || '').trim();
    const country = countryKey(row.rsr_country || '');
    if (!scopeKeys.has(`${code}||${country}`)) continue; // outside scope, not an exclusion

    const amount = typeof row.bill_dollars === 'number' ? row.bill_dollars : 0;
    if (!(amount > 0)) {
      exclude('no billed amount yet');
      continue;
    }
    const fx = usdFactor(row);
    if (fx === null) {
      exclude('no USD conversion');
      continue;
    }
    const key = `${code}||${country}||${normalizeJobTitle(row.title_cleaned || '')}`;
    if (!joins.has(key)) {
      unmatchedSpend += amount * fx;
      exclude('title not on both cards');
      continue;
    }
    const entry = spendByKey.get(key) ?? { spend: 0, active: 0 };
    entry.spend += amount * fx;
    entry.active += Number(row.is_open) === 1 ? 1 : 0;
    spendByKey.set(key, entry);
  }

  // --- roll join keys up to roles, weighting the change by spend ------------
  const roleAcc = new Map<
    string,
    { weighted: number; spend: number; active: number; lines: number; changeSum: number }
  >();
  for (const [key, join] of joins) {
    const change = join.sum / join.lines;
    const actual = spendByKey.get(key);
    const acc = roleAcc.get(join.role) ?? { weighted: 0, spend: 0, active: 0, lines: 0, changeSum: 0 };
    acc.lines += join.lines;
    acc.changeSum += change;
    if (actual) {
      acc.weighted += change * actual.spend;
      acc.spend += actual.spend;
      acc.active += actual.active;
    }
    roleAcc.set(join.role, acc);
  }

  const roles: RoleBubble[] = [];
  const rolesWithoutSpend: string[] = [];
  for (const [role, acc] of roleAcc) {
    if (acc.spend <= 0) {
      rolesWithoutSpend.push(role);
      continue;
    }
    const change = acc.weighted / acc.spend;
    roles.push({
      role,
      change,
      spend: acc.spend,
      activeWorkers: acc.active,
      impact: (acc.spend * change) / 100,
      lines: acc.lines,
    });
  }

  const totalSpend = roles.reduce((n, r) => n + r.spend, 0);
  const totalImpact = roles.reduce((n, r) => n + r.impact, 0);
  const portfolioChange = totalSpend ? (totalImpact * 100) / totalSpend : 0;
  const spendThreshold = median(roles.map((r) => r.spend));
  const watchList = roles
    .filter((r) => r.change > portfolioChange && r.spend >= spendThreshold && r.impact > 0)
    .sort((a, b) => b.impact - a.impact);

  return {
    fromYear,
    toYear,
    roles: roles.sort((a, b) => b.spend - a.spend),
    portfolioChange,
    spendThreshold,
    watchList,
    watchImpact: watchList.reduce((n, r) => n + r.impact, 0),
    totalImpact,
    totalSpend,
    rolesWithoutSpend: rolesWithoutSpend.sort(),
    unmatchedSpend,
    excluded: Array.from(tally, ([reason, count]) => ({ reason, count })).sort(
      (a, b) => b.count - a.count
    ),
    unresolvedClients: Array.from(unresolved).sort(),
  };
};
