# Domo ETL build spec — rate card actuals

Every dataset the app reads, and where each one comes from.

| Output | Grain | Source table | What the app does with it | Status |
| --- | --- | --- | --- | --- |
| `rate_card_client_directory` | one row per client | assignment | Candidates for Client Matching | **built** |
| `rate_card_actuals_assignment` | one row per assignment | assignment | Every actuals report | build next |
| `rate_card_title_directory` | title x client | assignment | Candidates for Title Matching | build with the title matcher |
| `rate_card_actuals_summary` | title x geo x year | dataflow 2 | Fallback if dataflow 2 is too large | probably not needed |

**The invoice table is not needed for any of this.** The assignment table has
no spend column — spend exists only on the invoice table — but none of the
planned reports require it. Dataflow 2 derives `pay_dollars` from rate x hours,
which is what weighting an average and ranking titles by materiality actually
need.

Know the limit of that figure: it is *computed pay*, not *invoiced spend*. It
excludes overtime, expenses, MSP fees and tax adjustments, and it is pay-side
rather than bill-side, so it will not reconcile against finance. Label it as
pay wherever it surfaces and nobody will mistake the two. If a report is ever
asked to tie to a finance number, that is the point to add an invoice rollup
grouped to `assignment_unique_key` — and not before, since joining that table
un-grouped multiplies every assignment by its invoice line count.

Tile names below follow Magic ETL. Verify them against your instance's version
before assuming a tile exists under exactly that name.

---

## Before you start: settle the grain

Everything downstream branches on this answer.

```sql
SELECT COUNT(*) AS rows,
       COUNT(DISTINCT assignment_unique_key) AS assignments,
       COUNT(DISTINCT calendar_reporting_month_date) AS months
FROM <assignment_table>
```

- **rows = assignments** → the table is at assignment grain. Skip tiles 4–7.
- **rows > assignments** → monthly snapshot. Build tiles 4–7.

---

## Dataflow 1 — `rate_card_client_directory` (built)

Recorded for completeness.

| # | Tile | Configuration |
| --- | --- | --- |
| 1 | Input DataSet | assignment table |
| 2 | Select Columns | `rsr_client_code`, `account_name`, `country`, `active_client`, `billable_hours`, `calendar_reporting_month_date` |
| 3 | Filter Rows | `active_client` is true |
| 4 | Group By | Group: `rsr_client_code`, `account_name`, `country` · Aggregate: `SUM(billable_hours)` → `hours`, `MAX(calendar_reporting_month_date)` → `latest_month` |
| 5 | Output DataSet | `rate_card_client_directory` · **Replace** |

Export order for pasting into the app's Client Matching tab:
`rsr_client_code, account_name, country, hours, latest_month`.

---

## Dataflow 2 — `rate_card_actuals_assignment`

One row per assignment. This is what the app reads.

### Tile 1 — Input DataSet

The assignment table.

### Tile 2 — Select Columns

**Do this before anything else.** On a ~200-column table it is the single
largest performance win in the whole dataflow.

Keep exactly these:

```
assignment_unique_key, req_unique_key, assignment_id,
calendar_reporting_month_date,

rsr_client_code, account_name, program_program_name,
contracting_country, active_client,

country, state_province, city, market, rsr_region,
location_level_2, location_level_3, location_level_4, location_level_5,

title_cleaned, req_title, req_title_classification,
ms_category_1, ms_category_2, soc_broad_group, onet_detailed_occupation,

labor_type, rsr_labor_type, collar_type, specialization,
contingent_vs_sow, req_type,

supplier, supplier_code, preferred_supplier_status, supplier_category,

pay_rate_st_hr, pay_rate_st_hr_initial, pay_rate_st_hr_usd,
bill_rate_st_hr, bill_rate_st_hr_initial, bill_rate_st_hr_usd,
supplier_bill_rate_st_hr, markup, assignment_markup_st_hr,
assignment_markup_st_hr_initial, currency,

max_template_bill_rate_st_hr, max_requested_bill_rate_st_hr,
presented_bill_rate_st_hr,
compliance_vs_max_bill_rate, compliance_vs_max_template_bill_rate,

billable_hours, positions_requested_cnt,

assignment_original_start_date, assignment_start_date,
assignment_end_date, assignment_original_end_date, assignment_status,

current_tenure_cd, planned_tenure_cd, time_to_fill_cd,

pay_rate_flag, bill_rate_flag, randstad_sourceright_flag
```

**Deliberately excluded:** `worker`, `worker_id`, `consolidated_worker_id`,
`cand_id`, `cand_unique_key`. Individual pay attached to a named person is a
materially more sensitive dataset than aggregate rates by job title, this feeds
a browser app, and no report needs it.

### Tile 3 — Filter Rows

| Condition | Why |
| --- | --- |
| `pay_rate_st_hr` > 0 | A zero or null rate cannot be compared to a band. Swap in `pay_rate_flag` once its meaning is confirmed. |
| `assignment_original_start_date` >= earliest card year − 1 | Bounds the pull. With cards from 2025, use 2024-01-01. |
| `contingent_vs_sow` = `Contingent` | **Only if** the card is contingent-only. Skip if it covers SOW too. |

**Do not filter on `assignment_status`.** Closed assignments are the completed
record; open ones are the only rows still correctable, and they are absent from
the invoice table entirely.

---

### If the table is already at assignment grain

Skip to tile 8, but insert one Add Formula tile so both paths converge on the
same schema:

```
hours_to_date = billable_hours
```

Everything downstream then reads `hours_to_date` regardless of which path ran.

---

### Snapshot path — two branches off tile 3

The two facts need opposite treatment. Rates describe current state; hours
accumulate.

#### Branch A — hours

**Tile 4A — Group By**

- Group by: `assignment_unique_key`
- Aggregate:
  - `SUM(billable_hours)` → `hours_to_date`
  - `MIN(calendar_reporting_month_date)` → `first_seen_month`
  - `COUNT(*)` → `snapshot_months`

`snapshot_months` is a cheap sanity check — an assignment with 14 snapshots and
40 hours is telling you something is wrong with the source.

#### Branch B — current state

**Tile 4B — Rank & Window**

- Function: `ROW_NUMBER`
- Partition by: `assignment_unique_key`
- Order by: `calendar_reporting_month_date` **descending**
- Output column: `snapshot_rank`

Use `ROW_NUMBER`, not `RANK`. If two snapshots share the same reporting month
for one assignment, `RANK` gives both rank 1 and you silently double that
assignment. If only `RANK` is available, follow tile 5B with a **Remove
Duplicates** tile on `assignment_unique_key`.

**Tile 5B — Filter Rows**

- `snapshot_rank` = 1

**Tile 6B — Select Columns**

Drop `billable_hours`, `calendar_reporting_month_date` and `snapshot_rank`.
Hours come from Branch A; keeping this branch's single-month figure invites
someone to use the wrong one later.

#### Tile 7 — Join Data

- Left: Branch B (one row per assignment, current state)
- Right: Branch A (hours)
- Join type: **Left**
- Key: `assignment_unique_key`

Both branches derive from the same filtered set, so the key sets should match
exactly. Left rather than inner means a gap shows up as a null you can see
rather than a row that vanishes.

---

### Tile 8 — Add Formula

Derived measures computed once here, not in the browser.

```sql
-- The card year in force when the assignment started. Emitted as text to
-- match the app's rateYear, which is a string parsed from a column header.
card_year = CAST(YEAR(assignment_original_start_date) AS CHAR)

-- Rate movement on the same assignment: the renewal question.
pay_drift = pay_rate_st_hr - pay_rate_st_hr_initial

pay_drift_pct = CASE WHEN pay_rate_st_hr_initial > 0
                     THEN (pay_rate_st_hr - pay_rate_st_hr_initial)
                          / pay_rate_st_hr_initial
                     ELSE NULL END

-- Pre-multiplied so hours-weighted averages are a division downstream.
pay_dollars  = pay_rate_st_hr  * hours_to_date
bill_dollars = bill_rate_st_hr * hours_to_date

-- Open assignments are the correctable ones.
is_open = CASE WHEN assignment_end_date IS NULL
                 OR assignment_end_date > CURRENT_DATE()
               THEN 1 ELSE 0 END

extended = CASE WHEN assignment_original_end_date IS NOT NULL
                 AND assignment_end_date > assignment_original_end_date
                THEN 1 ELSE 0 END
```

`card_year` as text is not cosmetic. The app's `rateYear` is a string parsed
from the column header (`"Max Pay - National Average (2026)"`), and an integer
year will not match it on join.

### Tile 9 — Output DataSet

- Name: `rate_card_actuals_assignment`
- Update method: **Replace**
- Schedule: after the assignment table updates

Aim for **under ~50k rows**. If it runs larger, tighten tile 3 by client or by
year before reaching for the summary below.

---

## Dataflow 3 — `rate_card_title_directory`

The candidate list the title matcher scores against — the direct analogue of
the client directory, and needed before title matching can work at all.

The **measures** are scoped per client, because the card is per client: the
same title sits at different rates for different accounts, and a reviewer
resolving "Systems Engineer" needs the rates for *their* client. The
**taxonomy** is not — SOC and O*NET codes are derived from the title string by
a classification engine, so they belong at title grain and are joined on.

### Group By cannot carry a text column through

`MIN()` and `MAX()` are offered on numeric and date columns only. For text the
aggregations are Count and Distinct Count, neither of which passes the value
through, so the taxonomy columns cannot be aggregated. Two ways round it, and
the check below decides which you need.

```sql
-- Does one title ever carry more than one classification?
SELECT title_cleaned,
       COUNT(DISTINCT onet_detailed_occupation) AS occupations,
       COUNT(DISTINCT soc_broad_group)          AS soc_groups,
       COUNT(DISTINCT ms_category_1)            AS ms_categories
FROM <assignment_table>
WHERE title_cleaned IS NOT NULL AND title_cleaned <> ''
GROUP BY 1
HAVING COUNT(DISTINCT onet_detailed_occupation) > 1
    OR COUNT(DISTINCT soc_broad_group) > 1
    OR COUNT(DISTINCT ms_category_1) > 1
ORDER BY 2 DESC, 3 DESC
```

**Returns nothing** — taxonomy is functionally dependent on the title. Add the
taxonomy columns to the Group By **keys** alongside the other four. They
aggregate nothing and add no rows, and the whole dataflow stays five tiles.

**Returns rows** — a title carries more than one classification, so adding
those columns to the keys would split one title into several, dividing its
hours across them. A title that looks small enough to skip because its hours
landed in two half-size rows is exactly the wrong outcome for a screen a
reviewer uses to judge materiality. Build the lookup branch instead.

### Tiles — measures

| # | Tile | Configuration |
| --- | --- | --- |
| 1 | Input DataSet | assignment table |
| 2 | Select Columns | `title_cleaned`, `rsr_client_code`, `country`, `labor_type`, `assignment_unique_key`, `billable_hours`, `pay_rate_st_hr` · plus the taxonomy columns **only if** the check came back clean |
| 3 | Filter Rows | `title_cleaned` is not blank · `pay_rate_st_hr` > 0 |
| 4 | Add Formula | `pay_dollars = pay_rate_st_hr * billable_hours` |
| 5 | Group By | Group: `title_cleaned`, `rsr_client_code`, `country`, `labor_type` · plus the taxonomy columns **as further group keys** if the check was clean |

Aggregations for tile 5 — every one of these is numeric, which is the point:

- `SUM(billable_hours)` → `hours`
- `SUM(pay_dollars)` → `pay_dollars`
- `COUNT DISTINCT assignment_unique_key` → `assignments`
- `MIN(pay_rate_st_hr)` → `pay_rate_min`, `MAX(pay_rate_st_hr)` → `pay_rate_max`

### Tiles — taxonomy lookup (only if the check returned rows)

One row per title, carrying the classification that row set most recently
agreed on. Same Rank & Window pattern as dataflow 2's branch B.

| # | Tile | Configuration |
| --- | --- | --- |
| 6 | Input DataSet | assignment table (a second input, off the same source) |
| 7 | Select Columns | `title_cleaned`, `calendar_reporting_month_date`, `billable_hours`, `req_title_classification`, `ms_category_1`, `ms_category_2`, `soc_broad_group`, `onet_detailed_occupation` |
| 8 | Filter Rows | `title_cleaned` is not blank |
| 9 | Rank & Window | `ROW_NUMBER` · Partition: `title_cleaned` · Order: `calendar_reporting_month_date` **desc**, then `billable_hours` **desc** · Output: `taxonomy_rank` |
| 10 | Filter Rows | `taxonomy_rank = 1` |
| 11 | Select Columns | Drop `calendar_reporting_month_date`, `billable_hours`, `taxonomy_rank` |

Ordering by reporting month descending takes the **most recent**
classification, on the reasoning that a classification engine's output improves
rather than degrades over time. Hours descending is the tiebreak, so two rows
in the same month resolve to the one with more work behind it rather than
arbitrarily.

### Joining and output

| # | Tile | Configuration |
| --- | --- | --- |
| 12 | Join Data | Left: tile 5 (measures) · Right: tile 11 (taxonomy) · **Left join** · Key: `title_cleaned` |
| 13 | Add Formula | `pay_rate_weighted = pay_dollars / hours` |
| 14 | Output DataSet | `rate_card_title_directory` · **Replace** |

Joining on `title_cleaned` alone is deliberate. The lookup is at title grain,
so one row matches per title regardless of how many client rows the measures
produced — no fan-out. Had the lookup been built per client as well, every
client without that title would have gone null for no reason.

**This dataflow is snapshot-safe either way.** The measures only sum hours and
count distinct assignment keys, and the lookup picks a single row per title, so
both give the same answer whether the source is at assignment grain or monthly
snapshot. No grain branch needed, whatever the check at the top of this
document said.

If the check did return rows, that is worth following up on its own: it means
the four categorization columns disagree with each other for some titles, and
settling which one is authoritative matters before any of them is used for
fallback matching.

The `pay_rate_min` / `pay_rate_max` pair is what makes a reviewer's decision
possible: a candidate title whose actual range sits nowhere near the card band
is probably the wrong match, however well the strings score.

---

## Dataflow 4 — `rate_card_actuals_summary` (fallback only)

Build this only if Dataflow 2 exceeds what the app can pull.

**Read this before you start:** Magic ETL's Group By has no percentile
aggregation. p25 / median / p75 need either a SQL dataflow or `PERCENT_RANK` in
Rank & Window, if your instance offers it. The better answer is usually to keep
Dataflow 2 and compute percentiles in the app, where they can be recomputed at
any grain — a summary can only ever serve the grain it was built at.

If you build it anyway, emit **each grain as its own row set**, because
percentiles and weighted averages cannot be rolled up from other percentiles:

| # | Tile | Configuration |
| --- | --- | --- |
| 1 | Input DataSet | `rate_card_actuals_assignment` |
| 2a | Add Constants | `grain` = `national` |
| 3a | Group By | Group: `rsr_client_code`, `title_cleaned`, `country`, `card_year`, `labor_type`, `grain` |
| 2b | Add Constants | `grain` = `state` |
| 3b | Group By | Same, plus `state_province` |
| 4 | Append Rows | Stack both branches |
| 5 | Add Formula | `pay_rate_weighted = pay_dollars / hours` |
| 6 | Output DataSet | `rate_card_actuals_summary` · **Replace** |

Aggregations for both Group By tiles:

- `SUM(hours_to_date)` → `hours`
- `SUM(pay_dollars)` → `pay_dollars`
- `SUM(bill_dollars)` → `bill_dollars`
- `COUNT DISTINCT assignment_unique_key` → `assignments`
- `MIN(pay_rate_st_hr)` → `pay_rate_min`
- `MAX(pay_rate_st_hr)` → `pay_rate_max`

The weighted average has to be a division after the Group By — summing the
products and dividing by summed hours. Averaging `pay_rate_st_hr` directly
weights every assignment equally, which treats a three-week placement the same
as a two-year one.

---

## Appendix — SQL equivalent of Dataflow 2

For a SQL dataflow instead of Magic ETL. Written with plain subqueries and no
window functions or CTEs, so it runs on the older MySQL dialects as well as the
newer engines. Verify the date functions against your instance.

```sql
SELECT
    s.*,
    h.hours_to_date,
    h.snapshot_months,
    CAST(YEAR(s.assignment_original_start_date) AS CHAR)     AS card_year,
    s.pay_rate_st_hr - s.pay_rate_st_hr_initial              AS pay_drift,
    s.pay_rate_st_hr  * h.hours_to_date                      AS pay_dollars,
    s.bill_rate_st_hr * h.hours_to_date                      AS bill_dollars
FROM assignment_src s
INNER JOIN (
    -- current state: the newest snapshot per assignment
    SELECT assignment_unique_key,
           MAX(calendar_reporting_month_date) AS latest_month
    FROM assignment_src
    WHERE pay_rate_st_hr > 0
      AND assignment_original_start_date >= '2024-01-01'
    GROUP BY assignment_unique_key
) latest
    ON  latest.assignment_unique_key    = s.assignment_unique_key
    AND latest.latest_month             = s.calendar_reporting_month_date
LEFT JOIN (
    -- hours accumulate across every snapshot
    SELECT assignment_unique_key,
           SUM(billable_hours) AS hours_to_date,
           COUNT(*)            AS snapshot_months
    FROM assignment_src
    WHERE pay_rate_st_hr > 0
      AND assignment_original_start_date >= '2024-01-01'
    GROUP BY assignment_unique_key
) h
    ON h.assignment_unique_key = s.assignment_unique_key
WHERE s.pay_rate_st_hr > 0
  AND s.assignment_original_start_date >= '2024-01-01'
```

The `latest` join carries the same tie risk as `RANK`: two rows sharing the
newest month for one assignment both survive. Confirm with

```sql
SELECT COUNT(*), COUNT(DISTINCT assignment_unique_key) FROM <output>
```

and add a tiebreak on `assignment_id` if those differ.
