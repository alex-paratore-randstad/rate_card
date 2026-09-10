# Supplementing the rate card with Domo assignment data

The uploaded rate card holds **pay bands** — `Min Pay` / `Max Pay`, national
average, keyed on job title x labor type x rate year x client x country. Domo
supplements it with the three things the card cannot know on its own: **what
was actually paid**, **where**, and **how much volume sits behind it**.

Two source tables were sampled: an **assignment** table (~200 columns, keyed on
`assignment_unique_key`) and an **invoice** table (~250 columns, at
invoice-line-item grain). The assignment table is the one to build on.

---

## 1. Which table to use

Two tables are in play. **The assignment table is the primary source** — it is
at assignment grain, and it carries `billable_hours`, so it needs no join to
the invoice table to weight anything.

Use the invoice table only for questions that are genuinely invoice-level:
monthly spend trend, MSP fees, tax adjustments, invoice approval cycle time.
Nothing in the rate card reporting needs it.

### Assignment table — the shortlist

| Purpose | Columns |
| --- | --- |
| Pay actuals, and drift on the same assignment | `pay_rate_st_hr`, `pay_rate_st_hr_initial`, `pay_rate_st_hr_usd` |
| Bill side and markup | `bill_rate_st_hr`, `bill_rate_st_hr_initial`, `bill_rate_st_hr_usd`, `supplier_bill_rate_st_hr`, `markup`, `assignment_markup_st_hr` |
| Ceilings enforced in the VMS | `max_template_bill_rate_st_hr`, `max_requested_bill_rate_st_hr`, `presented_bill_rate_st_hr` |
| **Compliance, already computed** | `compliance_vs_max_bill_rate`, `compliance_vs_max_template_bill_rate` |
| Weighting and materiality | `billable_hours`, `positions_requested_cnt` |
| Grain keys | `assignment_unique_key`, `req_unique_key`, `assignment_id` |
| Lifecycle dates | `assignment_original_start_date`, `assignment_start_date`, `assignment_end_date`, `assignment_original_end_date`, `assignment_status` |
| Tenure and fill speed | `current_tenure_cd`, `planned_tenure_cd`, `time_to_fill_cd` |
| Client identity | `rsr_client_code`, `account_name`, `program_program_name`, `contracting_country`, `active_client` |
| Geography | `country`, `state_province`, `city`, `market`, `rsr_region`, `location_level_2..5` |
| Role and taxonomy | `title_cleaned`, `req_title`, `req_title_classification`, `ms_category_1/2`, `soc_broad_group`, `onet_detailed_occupation` |
| Role dimensions | `labor_type`, `rsr_labor_type`, `collar_type`, `specialization`, `contingent_vs_sow`, `req_type` |
| Supplier | `supplier`, `preferred_supplier_status`, `supplier_category` |
| Data quality gates | `pay_rate_flag`, `bill_rate_flag`, `markup_flag`, `randstad_sourceright_flag` |

Three columns change the plan materially:

- **`billable_hours` is on the assignment table.** Hours were the one thing
  expected to require an invoice-side rollup. They do not.
- **`compliance_vs_max_template_bill_rate` already exists.** The headline
  compliance measure is computed upstream. Compute it independently as well and
  compare the two — agreement is confirmation, disagreement is a finding about
  which definition of the ceiling is in force.
- **The `_initial` pairs** (`pay_rate_st_hr_initial`,
  `bill_rate_st_hr_initial`, `assignment_markup_st_hr_initial`) turn rate drift
  at extension into a single-row calculation, with no history table needed.

### Do not pull

- **Worker-identifying columns: `worker`, `worker_id`, `consolidated_worker_id`,
  `cand_id`, `cand_unique_key`.** This is a rate card tool reporting on roles
  and markets, and it renders in a browser. Individual pay attached to a named
  person is a materially more sensitive dataset than aggregate rates for a job
  title, and none of the reports need it. If a distinct-people count is ever
  required, aggregate it in the dataflow and emit the count.
- The `*_savings_in_{cad,eur,gbp,inr,usd}` families and every `*_fx_rate` —
  the `_usd` rate columns already carry normalized values.
- Invoice plumbing, which lives on the other table anyway.

### Unresolved

- Which of `bg_categorization`, `tk_categorization`, `rand_categorization`,
  `rmi_categorization` is authoritative.
- What `R1_label`..`R6_label` and `R_score` represent.
- Whether `pay_rate_flag` / `bill_rate_flag` / `markup_flag` are data-quality
  indicators. If they are, they replace hand-rolled `rate > 0` filtering.
- Whether `billable_hours` is hours to date or hours in the reporting period —
  which follows from the grain question below.

---

## 2. The grain question — settle this first

`assignment_unique_key` suggests one row per assignment. But
`calendar_reporting_month_date`, `current_date` and `reporting_date_ends` are
all present, which is the signature of a **monthly snapshot**: one row per
assignment per reporting month.

Check before building anything on it:

```sql
SELECT COUNT(*) AS rows,
       COUNT(DISTINCT assignment_unique_key) AS assignments,
       COUNT(DISTINCT calendar_reporting_month_date) AS months
FROM <assignment_table>
```

**If rows equal assignments**, the table is already at assignment grain. Use it
directly and skip the Group By in Output 2.

**If rows are a multiple of assignments**, it is a snapshot, and the two facts
need opposite treatment:

- **Rates, status, dates, dimensions** — take the *latest* snapshot per
  assignment. These describe current state; summing or averaging them is
  meaningless.
- **`billable_hours`** — `SUM` across every snapshot for the assignment, since
  each row then carries that month's hours. Taking the latest would report one
  month of hours as if it were the assignment's lifetime.

Getting this backwards is the one error that produces plausible-looking numbers
that are wrong: latest-snapshot hours understate long assignments by an order
of magnitude, and averaged rates smooth away exactly the extension drift the
`_initial` columns exist to expose.

---

## 3. Three join problems

### Client — fuzzy, resolved once

The uploaded client string ("Xerox") will not equal `account_name`
("Xerox Corporation"). Do not use the name as the join key. Resolve it once to
**`rsr_client_code`**, which is stable, and persist that decision.

Approach, implemented in `src/services/clientMatchService.ts`:

1. Normalize both sides — lowercase, strip diacritics, `&` -> `and`, drop
   punctuation, drop legal-entity suffix tokens (`inc`, `corp`, `ltd`, `llc`,
   `gmbh`, ...).
2. Score candidates: exact, core-equal, token containment, then token Jaccard
   blended with bigram Dice for typos and spacing.
3. **A human confirms the match in the UI**, and the pairing is written to the
   `rate_card_client_aliases` collection.

Only an exact or core-equal match against a *unique* candidate resolves
automatically. Anything else waits for confirmation, and two near-tied
candidates are flagged ambiguous rather than guessed. A wrong client match
silently blends two markets, which is the failure `ClientScopeBar` already
warns about — worth a click to avoid.

Keep the fuzzy logic in the app only. Domo should emit the raw `account_name`
and `rsr_client_code` and nothing clever, so there is one implementation of
matching rather than two that drift.

Watch out: `supplier_name_parent_account_name` is the **supplier** side, not
the client.

### Title — the harder problem

There is no raw job-title column. `title_cleaned` is the best direct key;
`main_document_title` is the req/SOW title and is noisier.

Exact normalized matching will resolve some fraction of card titles. The
fallback ladder is what makes the rest usable:

`title_cleaned` -> `ms_category_1/2` -> `onet_detailed_occupation` ->
`soc_broad_group` -> `soc_minor_group`

So a card title with no exact actuals can still be compared against its
occupational peer group instead of rendering blank. Every comparison must
surface which rung it matched on — a peer-group comparison is weaker evidence
than an exact title match and must not be presented as equivalent.

### Geography — the unlock

The card is a *national average*. Domo carries `state_province`, `city`,
`market`, `rsr_region` and `location_level_2..5`. This turns regional
differentials into something measured rather than assumed, which is what the
`regional-breakdown` branch was doing by assumption.

---

## 4. Reports this unlocks, ranked

1. **Card vs actual compliance** — share of hours inside band, above max, below
   min, per title. Cross-check against `compliance_vs_max_template_bill_rate`.
2. **Card coverage gaps** — titles with real spend and no card row; card rows
   with no assignments. Cheapest to build, immediately actionable.
3. **Rate drift at extension** — `pay_rate_st_hr` against
   `pay_rate_st_hr_initial`, per title and per supplier. Answers whether the
   card holds at renewal, which is where it is most often quietly abandoned.
4. **Point-in-time comparison** — judge each assignment against the card year
   in force at `assignment_original_start_date`, rather than bucketing by
   invoice month. This is what makes a multi-year card defensible.
5. **Measured regional differentials** — actual pay by state/market against the
   national card.
6. **Time to fill against card position** — `time_to_fill_cd` for titles priced
   near the card floor versus near the ceiling. If underpriced titles take
   materially longer to fill, that is the strongest available argument for
   revising a band, and it is an argument built on operational cost rather than
   on benchmark data someone can dispute.
7. **Markup view** — pay-to-bill spread by supplier and preferred status.

## 5. How to aggregate in Domo before connecting

Do not point the app at the raw table: ~200 columns at snapshot grain is far
more than the browser should pull, and the aggregation has to be correct before
it is displayed.

Build **two outputs**. The first is small and unblocks client matching
immediately.

### Output 1 — `rate_card_client_directory` (done)

The candidate list the matcher scores against. A few hundred rows.

1. **Input DataSet** — the assignment table.
2. **Select Columns** — `rsr_client_code`, `account_name`, `country`,
   `active_client`, `billable_hours`, `calendar_reporting_month_date`.
3. **Filter Rows** — `active_client` is true.
4. **Group By** — on `rsr_client_code` + `account_name` + `country`;
   `SUM(billable_hours)` and `MAX(calendar_reporting_month_date)`. The hours
   distinguish a live account from a dormant one when two names look alike.
5. **Output DataSet** — replace, not append.

Paste the result into the app's Client Matching tab, in the column order
`client code, account name, country, hours, latest month`.

### Output 2 — `rate_card_actuals_assignment`

**One row per assignment**, carrying the shortlist. Prefer this over a
pre-summarized table: percentiles do not roll up, so a summary fixed at one
grain cannot be re-aggregated to another, while assignment-level rows can be
sliced any way the app needs.

1. **Input DataSet** — the assignment table.
2. **Select Columns** — the shortlist only, and none of the worker-identifying
   columns. On a ~200-column table this is the single largest performance win,
   so do it first.
3. **Filter Rows**:
   - `pay_rate_st_hr` > 0 — or `pay_rate_flag`, once its meaning is confirmed
   - `assignment_original_start_date` on or after the earliest card year minus one
   - `contingent_vs_sow` = Contingent, if the card is contingent-only
   - Keep both open and closed assignments. Closed ones are the completed
     record; open ones are the only rows still correctable, and are missing
     from the invoice table entirely.
4. **Collapse the snapshot** — skip this step if the grain check showed one row
   per assignment. Otherwise, two branches joined back together on
   `assignment_unique_key`:
   - **Hours branch** — Group By `assignment_unique_key`,
     `SUM(billable_hours)` as `hours_to_date`.
   - **State branch** — the latest snapshot per assignment. Rank by
     `calendar_reporting_month_date` descending within
     `assignment_unique_key` and keep the first, or Group By
     `assignment_unique_key` taking `MAX(calendar_reporting_month_date)` and
     join that back to pick up the rest of the row.
   - **Join** the two on `assignment_unique_key`.
5. **Add Formula** — the derived measures, computed once here rather than in
   the browser:
   - `pay_drift = pay_rate_st_hr - pay_rate_st_hr_initial`
   - `pay_dollars = pay_rate_st_hr * hours_to_date`, for hours-weighted
     aggregation downstream
   - `card_year` from `assignment_original_start_date`, for the point-in-time
     comparison
6. **Output DataSet** — replace.

Aim for **under ~50k rows** in what the app pulls. Filter by client or by year
in the dataflow if it runs larger.

### If Output 2 is still too large

Pre-aggregate to `rsr_client_code` x `title_cleaned` x `country` x
`state_province` x `card_year`, carrying assignment count, `SUM` hours, the
hours-weighted pay rate, and p25 / median / p75.

Emit **every grain level** you intend to display — national and state as
separate row sets, flagged by a `grain` column — because percentiles cannot be
rolled up from percentiles. A state-level row set cannot produce the national
median.

**Hours-weighted averages need a detour**, since Group By cannot compute one
directly: sum `pay_dollars` and `hours_to_date` in the Group By, then divide
them in a Formula tile afterwards.

### Notes

- A **DataSet View** is cheaper than a dataflow, but only for filter and
  select. Anything with a Group By needs Magic ETL (or a SQL dataflow); at this
  size Magic ETL is the right choice.
- Schedule each output after the source updates, with output behaviour
  **replace**.
- Column names should be lowercase and stable. Renaming a column downstream
  breaks the app's read silently.

### Wiring it into the app

The app currently reaches only collections, through same-origin fetch against
`/domo/datastores/v1/collections/...` (`src/services/domoService.ts`). Reading
a dataset additionally needs:

1. A dataset mapping with an alias added to `public/manifest.json`.
2. The dataset shared with the app.
3. A republish — dataset mappings do not take effect on the running app.

Reads then go to `/data/v1/<alias>` with query parameters for fields, filter,
limit and offset. **Verify the exact mapping shape and endpoint against the
`fte_tool` app**, which already reads a dataset in this instance, rather than
against the public documentation — `domo.js` is not served here and this
instance has diverged from the documented defaults before.
