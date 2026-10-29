# Sample data for user testing

Everything here is invented: clients, suppliers, rates and hours. Regenerate with
`node scripts/generate-sample-data.mjs`; a fixed seed means the output is the same
every time.

## Rate cards (upload on the Data tab)

| File | Layout it exercises | What to tag on upload |
| --- | --- | --- |
| `01_Northwind_Logistics_US_Rate_Card_2024-2026.xlsx` | One tab, three year columns. Two roles first appear in 2025. | Client `Northwind Logistics`, country `United States` |
| `02_Contoso_Pharma_Global_Rate_Card.xlsx` | Tabs per country (US, Canada, UK) plus a Notes tab the picker should skip. Canada in CAD, UK in GBP. | Per tab: client `Contoso Pharma`; country US / Canada / UK |
| `03_Fabrikam_MRA_Rate_Card_2026.xlsx` | Stacked, merged header rows (location › Pay/Bill › Min/Max). No year in the headers, so it loads as the current year. | Client `Fabrikam`, country `USA` |
| `04_Globex_Rate_Card_2025-2026.csv` | CSV with Client and Country columns on every row (US and Canada). | Nothing, it is already tagged |

The Fabrikam importer defaults to the **US National bill** columns. The actuals
are pay rates, so to compare like with like, point Min and Max at the
`US National › Pay Rate` columns in the mapping step.

## Standard title list

`05_Standard_Title_List.xlsx` holds 103 titles. Every card title has a counterpart,
under a different spelling or with seniority added ("Sr. Accountant",
"Software Engineer II").

## Domo datasets

| File | Replaces |
| --- | --- |
| `domo_rate_card_client_directory.csv` | `rate_card_client_directory` (21 rows, one per client per country) |
| `domo_rate_card_actuals_assignment.csv` | `rate_card_actuals_assignment` (3,645 assignments) |

Columns match `public/manifest.json` exactly.

What testers should see once clients and titles are matched:

- **Client matching:** Northwind matches automatically. Contoso and Fabrikam
  are suggested and need a click. Globex is ambiguous between Globex Holdings Inc
  and Globex Financial Services; the right answer is Holdings (`RSR10902`).
- **Title matching:** about a third of assignments spell the title differently
  from the card ("AP Specialist", "Warehouse Assoc", "Software Engineer 2"). Those
  hours stay outside any band until they are matched.
- **Compliance:** about 80% of hours sit in band, about 13% above max and 7% below
  min. Pay drift appears on about 30% of assignments.
- **Coverage gaps:** Logistics Coordinator, Inventory Analyst, Packer and Cloud
  Engineer have hours but appear on no card.
- **Rate movement:** Northwind spans 2024 to 2026; most roles rise 2.5–5% a year,
  some stay flat, a few rise faster and one or two go down.

## Test app

The test app is a second app design on sbxb, next to the real one: same code,
but its own name, its own storage and the dummy datasets. Nothing it saves
reaches the real app, and deleting it removes every piece of test data. It is
built on sbxb and promoted to UAT separately. The target is set in
`deploy.targets.json` under `test`.

**Set up once (on sbxb)**

1. Upload the two `domo_*.csv` files as datasets (Data › Connect data ›
   File Upload). Before saving, set `card_year` and `soc_broad_group` to **Text**.
   Copy each dataset's id from its URL (`/datasources/<id>/...`).
2. Put the two dataset ids into `deploy.targets.json` under `test.datasets`.
   Leave `designId` empty.
3. `npm run deploy:test -- --dry-run`, then check `dist-test/manifest.json`:
   TEST name, no `id`, dummy dataset ids.
4. `npm run deploy:test`. The first publish creates the design and writes its id
   into `deploy.targets.json`. Commit that file, or the next publish creates a
   second test design.
5. Add the new design ("Randstad Rate Card Tracker – TEST") as a card on a page
   only testers can see. If the card asks for its datasets, choose the two dummy
   datasets.

Later test publishes (`npm run deploy:test`) update the same design, and
`npm run deploy` still publishes the real app. The two never share a design id.

**Promoting to UAT**

Promote the test design and the two dummy datasets together. In UAT the app has
to read the UAT copies of those datasets, not the sbxb ids in its manifest, so
check the card's dataset bindings after promotion. Its storage starts empty in
UAT, so testers upload the rate cards and title list there.

**Remove everything (in each instance it reached)**

1. Delete the test card and its page.
2. Delete the design from the Asset Library. On sbxb you can instead run
   `npm run domo -- delete <designId>`.
3. Delete the two dummy datasets.
4. Delete the datasets Domo made from the test app's storage. They appear in the
   Data Center under the test app, named `rate_card_history`,
   `rate_card_feedback` and so on.
5. Clear `designId` and the dataset ids in `deploy.targets.json`.

### Using them locally

`npm run dev`, then in the browser console:

```js
const ds = await import('/src/services/datasetService.ts');
ds.seedLocalDataset('rate_card_client_directory', await (await fetch('/sample_data/local_seed_client_directory.json')).json());
ds.seedLocalDataset('rate_card_actuals_assignment', await (await fetch('/sample_data/local_seed_actuals_assignment.json')).json());
```
