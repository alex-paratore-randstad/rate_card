/**
 * Generate dummy input files for user testing.
 *
 * Writes to sample_data/:
 *   - four rate card files, one per fictional client, each in a layout the
 *     importer handles (year columns, multi-tab, stacked headers, CSV with
 *     client and country columns)
 *   - a standard title list
 *   - the two Domo datasets the app reads (client directory, assignment
 *     actuals) as CSV for upload to Domo, and as JSON for local seeding
 *
 * Every client, supplier and figure is invented. A fixed seed makes the output
 * identical on every run, so testers can be pointed at a specific row.
 *
 *   node scripts/generate-sample-data.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';

const OUT = path.resolve('sample_data');
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// Seeded randomness
// ---------------------------------------------------------------------------

let seed = 20261028;
const rand = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (lo, hi) => lo + rand() * (hi - lo);
const pick = (list) => list[Math.floor(rand() * list.length)];
const weighted = (pairs) => {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [value, w] of pairs) if ((r -= w) <= 0) return value;
  return pairs[pairs.length - 1][0];
};
const money = (n) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Roles
//
// `name` is the standard title. `card` is how a client's card spells it, which
// carries seniority and house style the matcher has to strip. `actual` is how
// the actuals spell it, which differs from the card often enough to give the
// title matching queue something to do. `pay` is the 2026 US minimum pay.
// ---------------------------------------------------------------------------

const ROLES = [
  // Light industrial
  { name: 'Warehouse Associate', card: 'Warehouse Associate', actual: 'Warehouse Assoc', pay: 17.5, collar: 'Blue', cat: 'Light Industrial', soc: '53-7000', onet: 'Laborers and Freight, Stock, and Material Movers, Hand' },
  { name: 'Forklift Operator', card: 'Forklift Operator', actual: 'Forklift Driver', pay: 19.25, collar: 'Blue', cat: 'Light Industrial', soc: '53-7000', onet: 'Industrial Truck and Tractor Operators' },
  { name: 'Material Handler', card: 'Material Handler', actual: 'Material Handler', pay: 18.0, collar: 'Blue', cat: 'Light Industrial', soc: '53-7000', onet: 'Laborers and Freight, Stock, and Material Movers, Hand' },
  { name: 'Machine Operator', card: 'Machine Operator II', actual: 'Machine Operator 2', pay: 20.5, collar: 'Blue', cat: 'Light Industrial', soc: '51-4000', onet: 'Machine Tool Operators' },
  { name: 'Assembler', card: 'Production Assembler', actual: 'Assembler', pay: 17.75, collar: 'Blue', cat: 'Light Industrial', soc: '51-2000', onet: 'Assemblers and Fabricators' },
  { name: 'Quality Inspector', card: 'Quality Control Inspector', actual: 'QC Inspector', pay: 21.0, collar: 'Blue', cat: 'Light Industrial', soc: '51-9000', onet: 'Inspectors, Testers, Sorters, Samplers, and Weighers' },
  { name: 'Maintenance Technician', card: 'Maintenance Technician', actual: 'Maintenance Tech', pay: 27.0, collar: 'Blue', cat: 'Skilled Trades', soc: '49-9000', onet: 'Maintenance and Repair Workers, General' },
  { name: 'Electrician', card: 'Industrial Electrician', actual: 'Electrician', pay: 34.0, collar: 'Blue', cat: 'Skilled Trades', soc: '47-2000', onet: 'Electricians' },
  { name: 'Shipping and Receiving Clerk', card: 'Shipping & Receiving Clerk', actual: 'Shipping and Receiving Clerk', pay: 18.5, collar: 'Blue', cat: 'Light Industrial', soc: '43-5000', onet: 'Shipping, Receiving, and Inventory Clerks' },
  // Office and administrative
  { name: 'Administrative Assistant', card: 'Administrative Assistant', actual: 'Admin Assistant', pay: 21.0, collar: 'White', cat: 'Administrative', soc: '43-6000', onet: 'Secretaries and Administrative Assistants' },
  { name: 'Executive Assistant', card: 'Executive Assistant', actual: 'Executive Assistant', pay: 30.0, collar: 'White', cat: 'Administrative', soc: '43-6000', onet: 'Executive Secretaries and Executive Administrative Assistants' },
  { name: 'Customer Service Representative', card: 'Customer Service Rep', actual: 'Customer Service Representative', pay: 19.0, collar: 'White', cat: 'Customer Service', soc: '43-4000', onet: 'Customer Service Representatives' },
  { name: 'Data Entry Clerk', card: 'Data Entry Clerk', actual: 'Data Entry Operator', pay: 17.5, collar: 'White', cat: 'Administrative', soc: '43-9000', onet: 'Data Entry Keyers' },
  { name: 'Receptionist', card: 'Receptionist', actual: 'Receptionist', pay: 18.0, collar: 'White', cat: 'Administrative', soc: '43-4000', onet: 'Receptionists and Information Clerks' },
  // Finance
  { name: 'Accounts Payable Specialist', card: 'Accounts Payable Specialist', actual: 'AP Specialist', pay: 24.0, collar: 'White', cat: 'Finance & Accounting', soc: '43-3000', onet: 'Bookkeeping, Accounting, and Auditing Clerks' },
  { name: 'Staff Accountant', card: 'Staff Accountant', actual: 'Staff Accountant', pay: 32.0, collar: 'White', cat: 'Finance & Accounting', soc: '13-2000', onet: 'Accountants and Auditors' },
  { name: 'Senior Accountant', card: 'Sr. Accountant', actual: 'Senior Accountant', pay: 40.0, collar: 'White', cat: 'Finance & Accounting', soc: '13-2000', onet: 'Accountants and Auditors' },
  { name: 'Financial Analyst', card: 'Financial Analyst II', actual: 'Financial Analyst', pay: 38.0, collar: 'White', cat: 'Finance & Accounting', soc: '13-2000', onet: 'Financial and Investment Analysts' },
  { name: 'Payroll Specialist', card: 'Payroll Specialist', actual: 'Payroll Coordinator', pay: 26.0, collar: 'White', cat: 'Finance & Accounting', soc: '43-3000', onet: 'Payroll and Timekeeping Clerks' },
  // IT
  { name: 'Help Desk Technician', card: 'Help Desk Technician I', actual: 'Help Desk Tech', pay: 23.0, collar: 'White', cat: 'Information Technology', soc: '15-1200', onet: 'Computer User Support Specialists' },
  { name: 'Desktop Support Technician', card: 'Desktop Support Technician', actual: 'Desktop Support Specialist', pay: 27.0, collar: 'White', cat: 'Information Technology', soc: '15-1200', onet: 'Computer User Support Specialists' },
  { name: 'Systems Administrator', card: 'Systems Administrator', actual: 'System Administrator', pay: 45.0, collar: 'White', cat: 'Information Technology', soc: '15-1200', onet: 'Network and Computer Systems Administrators' },
  { name: 'Software Engineer', card: 'Software Engineer II', actual: 'Software Engineer 2', pay: 58.0, collar: 'White', cat: 'Information Technology', soc: '15-1200', onet: 'Software Developers' },
  { name: 'Senior Software Engineer', card: 'Sr. Software Engineer', actual: 'Senior Software Engineer', pay: 72.0, collar: 'White', cat: 'Information Technology', soc: '15-1200', onet: 'Software Developers' },
  { name: 'Data Analyst', card: 'Data Analyst', actual: 'Data Analyst', pay: 36.0, collar: 'White', cat: 'Information Technology', soc: '15-2000', onet: 'Data Scientists' },
  { name: 'Business Analyst', card: 'Business Analyst III', actual: 'Business Analyst', pay: 44.0, collar: 'White', cat: 'Information Technology', soc: '13-1000', onet: 'Management Analysts' },
  { name: 'Project Manager', card: 'Project Manager', actual: 'Project Mgr', pay: 55.0, collar: 'White', cat: 'Information Technology', soc: '11-9000', onet: 'Project Management Specialists' },
  { name: 'QA Tester', card: 'QA Test Analyst', actual: 'Quality Assurance Tester', pay: 33.0, collar: 'White', cat: 'Information Technology', soc: '15-1200', onet: 'Software Quality Assurance Analysts and Testers' },
  { name: 'Network Engineer', card: 'Network Engineer', actual: 'Network Engineer', pay: 52.0, collar: 'White', cat: 'Information Technology', soc: '15-1200', onet: 'Computer Network Architects' },
  // Life sciences
  { name: 'Laboratory Technician', card: 'Lab Technician', actual: 'Laboratory Technician', pay: 24.5, collar: 'White', cat: 'Scientific', soc: '19-4000', onet: 'Biological Technicians' },
  { name: 'Research Associate', card: 'Research Associate I', actual: 'Research Associate', pay: 31.0, collar: 'White', cat: 'Scientific', soc: '19-1000', onet: 'Medical Scientists' },
  { name: 'Clinical Research Coordinator', card: 'Clinical Research Coordinator', actual: 'Clinical Research Coord', pay: 33.0, collar: 'White', cat: 'Scientific', soc: '11-9000', onet: 'Clinical Research Coordinators' },
  { name: 'Quality Assurance Specialist', card: 'QA Specialist - GMP', actual: 'Quality Assurance Specialist', pay: 35.0, collar: 'White', cat: 'Scientific', soc: '13-1000', onet: 'Compliance Officers' },
  { name: 'Regulatory Affairs Specialist', card: 'Regulatory Affairs Specialist', actual: 'Regulatory Affairs Specialist', pay: 42.0, collar: 'White', cat: 'Scientific', soc: '13-1000', onet: 'Compliance Officers' },
  { name: 'Chemist', card: 'Chemist II', actual: 'Chemist', pay: 37.0, collar: 'White', cat: 'Scientific', soc: '19-2000', onet: 'Chemists' },
  // HR and marketing
  { name: 'Recruiter', card: 'Recruiter', actual: 'Talent Acquisition Recruiter', pay: 32.0, collar: 'White', cat: 'Human Resources', soc: '13-1000', onet: 'Human Resources Specialists' },
  { name: 'HR Generalist', card: 'HR Generalist', actual: 'Human Resources Generalist', pay: 31.0, collar: 'White', cat: 'Human Resources', soc: '13-1000', onet: 'Human Resources Specialists' },
  { name: 'Marketing Coordinator', card: 'Marketing Coordinator', actual: 'Marketing Coordinator', pay: 26.0, collar: 'White', cat: 'Marketing', soc: '13-1000', onet: 'Market Research Analysts and Marketing Specialists' },
  { name: 'Graphic Designer', card: 'Graphic Designer', actual: 'Graphic Designer', pay: 30.0, collar: 'White', cat: 'Creative', soc: '27-1000', onet: 'Graphic Designers' },
  { name: 'Technical Writer', card: 'Technical Writer', actual: 'Tech Writer', pay: 36.0, collar: 'White', cat: 'Creative', soc: '27-3000', onet: 'Technical Writers' },
];
const roleByName = new Map(ROLES.map((r) => [r.name, r]));

/**
 * Titles that appear in the actuals but on no card — the coverage report's
 * "real spend, no card row".
 */
const UNCARDED = [
  { name: 'Logistics Coordinator', actual: 'Logistics Coordinator', pay: 23.0, collar: 'White', cat: 'Supply Chain', soc: '13-1000', onet: 'Logisticians' },
  { name: 'Inventory Analyst', actual: 'Inventory Analyst', pay: 27.0, collar: 'White', cat: 'Supply Chain', soc: '13-1000', onet: 'Logisticians' },
  { name: 'Cloud Engineer', actual: 'Cloud Engineer', pay: 66.0, collar: 'White', cat: 'Information Technology', soc: '15-1200', onet: 'Computer Network Architects' },
  { name: 'Packer', actual: 'Packer', pay: 16.5, collar: 'Blue', cat: 'Light Industrial', soc: '53-7000', onet: 'Packers and Packagers, Hand' },
];

/** Standard titles nothing on the cards maps to yet, so the list looks real. */
const EXTRA_STANDARD_TITLES = [
  'Account Analyst', 'Account Manager', 'Accounts Receivable Specialist', 'Application Developer',
  'Benefits Specialist', 'Billing Specialist', 'Buyer', 'Call Center Agent', 'Claims Processor',
  'Cloud Engineer', 'CNC Machinist', 'Collections Specialist', 'Compliance Analyst',
  'Construction Laborer', 'Content Writer', 'Contract Specialist', 'Cost Accountant',
  'Cybersecurity Analyst', 'Data Engineer', 'Data Scientist', 'Database Administrator',
  'DevOps Engineer', 'Dispatcher', 'Document Control Specialist', 'Electrical Engineer',
  'Engineering Technician', 'Facilities Coordinator', 'Field Service Technician',
  'General Laborer', 'Hardware Engineer', 'HVAC Technician', 'Instructional Designer',
  'Inventory Analyst', 'IT Auditor', 'Legal Assistant', 'Logistics Coordinator',
  'Machinist', 'Mechanical Engineer', 'Medical Assistant', 'Office Manager', 'Operations Analyst',
  'Order Picker', 'Packer', 'Paralegal', 'Planner', 'Process Engineer', 'Procurement Specialist',
  'Product Manager', 'Production Supervisor', 'Program Manager', 'Purchasing Agent',
  'Registered Nurse', 'Sales Representative', 'Scrum Master', 'Security Officer',
  'Solutions Architect', 'Supply Chain Analyst', 'Technical Support Engineer', 'Trainer',
  'UX Designer', 'Validation Engineer', 'Web Developer', 'Welder',
];

// ---------------------------------------------------------------------------
// Clients and geography
// ---------------------------------------------------------------------------

/**
 * `upload` is the client string a card arrives with; `account` is what Domo
 * calls it. Each pairing exercises a different matcher outcome: Northwind
 * resolves on its own, Contoso and Fabrikam are suggested for confirmation,
 * Globex is ambiguous between two accounts.
 */
const CLIENTS = [
  {
    key: 'northwind', upload: 'Northwind Logistics', code: 'RSR10421', account: 'Northwind Logistics Corporation',
    countries: ['US', 'CA'], roles: ['Warehouse Associate', 'Forklift Operator', 'Material Handler', 'Machine Operator', 'Shipping and Receiving Clerk', 'Maintenance Technician', 'Electrician', 'Quality Inspector', 'Customer Service Representative', 'Data Entry Clerk', 'Administrative Assistant', 'Accounts Payable Specialist', 'Payroll Specialist', 'Help Desk Technician', 'Systems Administrator', 'Project Manager', 'Recruiter', 'Business Analyst'],
    uncarded: ['Logistics Coordinator', 'Inventory Analyst', 'Packer'], assignments: 1100,
  },
  {
    key: 'contoso', upload: 'Contoso Pharma', code: 'RSR10588', account: 'Contoso Pharmaceuticals Inc',
    countries: ['US', 'CA', 'GB'], roles: ['Laboratory Technician', 'Research Associate', 'Clinical Research Coordinator', 'Quality Assurance Specialist', 'Regulatory Affairs Specialist', 'Chemist', 'Data Analyst', 'Business Analyst', 'Project Manager', 'Administrative Assistant', 'Executive Assistant', 'Staff Accountant', 'Senior Accountant', 'Financial Analyst', 'Technical Writer', 'HR Generalist', 'Marketing Coordinator', 'Quality Inspector', 'Material Handler'],
    uncarded: ['Logistics Coordinator'], assignments: 900,
  },
  {
    key: 'fabrikam', upload: 'Fabrikam', code: 'RSR10733', account: 'Fabrikam Industries LLC',
    countries: ['US'], roles: ['Software Engineer', 'Senior Software Engineer', 'QA Tester', 'Business Analyst', 'Project Manager', 'Data Analyst', 'Systems Administrator', 'Network Engineer', 'Help Desk Technician', 'Desktop Support Technician', 'Technical Writer', 'Graphic Designer'],
    uncarded: ['Cloud Engineer'], assignments: 600,
  },
  {
    key: 'globex', upload: 'Globex', code: 'RSR10902', account: 'Globex Holdings Inc',
    countries: ['US', 'CA'], roles: ['Customer Service Representative', 'Data Entry Clerk', 'Receptionist', 'Administrative Assistant', 'Accounts Payable Specialist', 'Staff Accountant', 'Financial Analyst', 'Payroll Specialist', 'Recruiter', 'HR Generalist', 'Help Desk Technician', 'Data Analyst', 'Marketing Coordinator'],
    uncarded: [], assignments: 500,
  },
];

/** Accounts with actuals but no card, including Globex's near-twin. */
const OTHER_ACCOUNTS = [
  { code: 'RSR11017', account: 'Globex Financial Services', countries: ['US'], assignments: 140 },
  { code: 'RSR11102', account: 'Tailspin Toys Inc', countries: ['US'], assignments: 60 },
  { code: 'RSR11145', account: 'Woodgrove Bank', countries: ['US', 'CA'], assignments: 90 },
  { code: 'RSR11188', account: 'Adventure Works Cycles Ltd', countries: ['GB'], assignments: 40 },
  { code: 'RSR11230', account: 'Litware Inc', countries: ['US'], assignments: 35 },
  { code: 'RSR11274', account: 'Lamna Healthcare Company', countries: ['US'], assignments: 75 },
  { code: 'RSR11319', account: 'Trey Research', countries: ['US'], assignments: 25 },
  { code: 'RSR11356', account: 'Wide World Importers', countries: ['US', 'CA'], assignments: 50 },
  { code: 'RSR11402', account: 'Northwind Traders Ltd', countries: ['GB'], assignments: 30 },
  { code: 'RSR11447', account: 'Proseware Corp', countries: ['US'], assignments: 0 },
  { code: 'RSR11489', account: 'Alpine Ski House', countries: ['CA'], assignments: 0 },
];

const COUNTRY = {
  US: { domo: 'UNITED STATES OF AMERICA', label: 'United States', currency: 'USD', factor: 1, region: 'North America',
    places: [['Texas', 'Dallas', 'Dallas-Fort Worth', 0.97], ['Illinois', 'Chicago', 'Chicago', 1.03], ['California', 'San Jose', 'San Francisco Bay Area', 1.22], ['Georgia', 'Atlanta', 'Atlanta', 0.96], ['Ohio', 'Columbus', 'Columbus', 0.93], ['New York', 'New York', 'New York Metro', 1.18], ['North Carolina', 'Raleigh', 'Raleigh-Durham', 0.98], ['Arizona', 'Phoenix', 'Phoenix', 0.95], ['Massachusetts', 'Boston', 'Boston', 1.15], ['Tennessee', 'Memphis', 'Memphis', 0.9]] },
  CA: { domo: 'CANADA', label: 'Canada', currency: 'CAD', factor: 1.28, region: 'North America',
    places: [['Ontario', 'Toronto', 'Greater Toronto Area', 1.06], ['Quebec', 'Montreal', 'Montreal', 0.95], ['British Columbia', 'Vancouver', 'Vancouver', 1.08], ['Alberta', 'Calgary', 'Calgary', 1.0]] },
  GB: { domo: 'UNITED KINGDOM', label: 'United Kingdom', currency: 'GBP', factor: 0.66, region: 'EMEA',
    places: [['England', 'London', 'London', 1.2], ['England', 'Manchester', 'Manchester', 0.94], ['Scotland', 'Edinburgh', 'Edinburgh', 0.97], ['England', 'Cambridge', 'Cambridge', 1.05]] },
};

/** Units of each currency per USD, as the source's FX conversion would apply. */
const PER_USD = { USD: 1, CAD: 1.37, EUR: 0.92, GBP: 0.79, INR: 83.4 };

const SUPPLIERS = [
  ['Randstad', 'Preferred', 'Tier 1'], ['Summit Staffing Group', 'Preferred', 'Tier 1'],
  ['BlueRiver Talent', 'Preferred', 'Tier 2'], ['Keystone Workforce', 'Approved', 'Tier 2'],
  ['Meridian Technical Resources', 'Approved', 'Tier 2'], ['Harbor Point Staffing', 'Approved', 'Tier 3'],
  ['Crestline Consulting', 'Non-Preferred', 'Tier 3'],
];

const YEARS = ['2024', '2025', '2026'];

// ---------------------------------------------------------------------------
// Card bands
//
// One band per client x country x role x year. Year-on-year movement varies by
// role so the rate movement report has risers, flat lines and the odd cut.
// ---------------------------------------------------------------------------

const movement = new Map(
  ROLES.map((r) => [r.name, weighted([[between(0.025, 0.05), 6], [0, 2], [between(0.06, 0.1), 2], [-between(0.01, 0.03), 1]])])
);
const spread = new Map(ROLES.map((r) => [r.name, between(1.22, 1.45)]));

/** Round the way rate cards are usually written: to the quarter. */
const quarter = (n) => Math.round(n * 4) / 4;

const bands = new Map(); // `${client}|${country}|${role}|${year}` -> { min, max }
const clientPremium = { northwind: 0.98, contoso: 1.05, fabrikam: 1.08, globex: 1.0 };

for (const client of CLIENTS) {
  for (const country of client.countries) {
    for (const roleName of client.roles) {
      const role = roleByName.get(roleName);
      const base2026 = role.pay * COUNTRY[country].factor * clientPremium[client.key];
      const step = movement.get(roleName);
      YEARS.forEach((year, i) => {
        const min = quarter(base2026 / Math.pow(1 + step, 2 - i));
        const max = quarter(min * spread.get(roleName));
        bands.set(`${client.key}|${country}|${roleName}|${year}`, { min, max });
      });
    }
  }
}
const band = (client, country, role, year) => bands.get(`${client.key}|${country}|${role}|${year}`);

// ---------------------------------------------------------------------------
// Rate card files
// ---------------------------------------------------------------------------

const writeBook = (file, sheets, colWidths) => {
  const wb = XLSX.utils.book_new();
  for (const { name, rows, merges } of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    if (merges) ws['!merges'] = merges;
    if (colWidths) ws['!cols'] = colWidths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  XLSX.writeFile(wb, path.join(OUT, file));
};

const laborTypeFor = (role) => (role.collar === 'Blue' ? 'Light Industrial' : 'Professional');

// 1. Northwind: one tab, three year columns, no client or country column — the
// uploader tags the batch in the mapping modal.
{
  const c = CLIENTS[0];
  const header = ['Job Titles', 'Labor Type', ...YEARS.flatMap((y) => [`Min Pay - National Average (${y})`, `Max Pay - National Average (${y})`])];
  const rows = c.roles.map((name) => {
    const role = roleByName.get(name);
    return [role.card, laborTypeFor(role), ...YEARS.flatMap((y) => {
      // Two roles were only added to the card in 2025.
      if (y === '2024' && ['Electrician', 'Business Analyst'].includes(name)) return ['', ''];
      const b = band(c, 'US', name, y);
      return [b.min, b.max];
    })];
  });
  writeBook('01_Northwind_Logistics_US_Rate_Card_2024-2026.xlsx', [{ name: 'Rate Card', rows: [header, ...rows] }], [34, 18, 16, 16, 16, 16, 16, 16]);
}

// 2. Contoso: one tab per country, plus a notes tab the tab picker should
// recognise as not being rate data.
{
  const c = CLIENTS[1];
  const header = ['Job Title', 'Labor Type', 'Min Pay (2025)', 'Max Pay (2025)', 'Min Pay (2026)', 'Max Pay (2026)'];
  const tab = (country) => [header, ...c.roles.map((name) => {
    const role = roleByName.get(name);
    const a = band(c, country, name, '2025');
    const b = band(c, country, name, '2026');
    return [role.card, laborTypeFor(role), a.min, a.max, b.min, b.max];
  })];
  writeBook('02_Contoso_Pharma_Global_Rate_Card.xlsx', [
    { name: 'US', rows: tab('US') },
    { name: 'Canada', rows: tab('CA') },
    { name: 'UK', rows: tab('GB') },
    { name: 'Notes', rows: [['Contoso Pharma rate card — notes'], ['Rates are hourly pay in local currency.'], ['Canada in CAD, UK in GBP.'], ['Approved by program office, January 2026.']] },
  ], [34, 16, 14, 14, 14, 14]);
}

// 3. Fabrikam: an MRA-style card with stacked, merged header rows — location
// over Pay Rate / Bill Rate over Min / Max. The importer folds these and
// defaults to the US bill pair; the bill band is the pay band x 1.38, and on
// these cards max is always min x 11/9.
{
  const c = CLIENTS[2];
  const markup = 1.38;
  const remote = 0.94;
  const top = ['Fabrikam Industries — MRA Rate Card 2026', '', '', '', '', '', '', '', '', ''];
  const loc = ['', '', 'US National', '', '', '', 'US Remote', '', '', ''];
  const kind = ['', '', 'Pay Rate', '', 'Bill Rate', '', 'Pay Rate', '', 'Bill Rate', ''];
  const head = ['Job Title', 'Job Class', 'Min Rate', 'Max Rate', 'MRA Suggested Min Rate', 'MRA Suggested Max Rate', 'Min Rate', 'Max Rate', 'MRA Suggested Min Rate', 'MRA Suggested Max Rate'];
  const rows = c.roles.map((name) => {
    const role = roleByName.get(name);
    const payMin = band(c, 'US', name, '2026').min;
    const pair = (min) => [quarter(min), quarter((min * 11) / 9)];
    return [role.card, laborTypeFor(role), ...pair(payMin), ...pair(payMin * markup), ...pair(payMin * remote), ...pair(payMin * remote * markup)];
  });
  writeBook('03_Fabrikam_MRA_Rate_Card_2026.xlsx', [{
    name: 'MRA 2026',
    rows: [top, loc, kind, head, ...rows],
    merges: [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 9 } },
      { s: { r: 1, c: 2 }, e: { r: 1, c: 5 } }, { s: { r: 1, c: 6 }, e: { r: 1, c: 9 } },
      { s: { r: 2, c: 2 }, e: { r: 2, c: 3 } }, { s: { r: 2, c: 4 }, e: { r: 2, c: 5 } },
      { s: { r: 2, c: 6 }, e: { r: 2, c: 7 } }, { s: { r: 2, c: 8 }, e: { r: 2, c: 9 } },
    ],
  }], [30, 16, 11, 11, 14, 14, 11, 11, 14, 14]);
}

// 4. Globex: CSV with client and country on every row, so nothing needs tagging.
{
  const c = CLIENTS[3];
  const lines = [['Client', 'Country', 'Job Title', 'Labor Type', 'Min Rate (2025)', 'Max Rate (2025)', 'Min Rate (2026)', 'Max Rate (2026)']];
  for (const country of c.countries) {
    for (const name of c.roles) {
      const role = roleByName.get(name);
      const a = band(c, country, name, '2025');
      const b = band(c, country, name, '2026');
      lines.push([c.upload, COUNTRY[country].label === 'United States' ? 'USA' : COUNTRY[country].label, role.card, laborTypeFor(role), a.min.toFixed(2), a.max.toFixed(2), b.min.toFixed(2), b.max.toFixed(2)]);
    }
  }
  fs.writeFileSync(path.join(OUT, '04_Globex_Rate_Card_2025-2026.csv'), toCsv(lines));
}

// ---------------------------------------------------------------------------
// Standard title list: one column, headed, as the app's own export writes it.
// ---------------------------------------------------------------------------

{
  const titles = Array.from(new Set([...ROLES.map((r) => r.name), ...EXTRA_STANDARD_TITLES])).sort();
  writeBook('05_Standard_Title_List.xlsx', [{ name: 'Standard Titles', rows: [['Standard Title'], ...titles.map((t) => [t])] }], [40]);
}

// ---------------------------------------------------------------------------
// Assignment actuals
// ---------------------------------------------------------------------------

const actuals = [];
let serial = 100000;

const fx = (local, currency) => {
  const usd = local / PER_USD[currency];
  return {
    pay_rate_st_hr_usd: money(usd),
    pay_rate_st_hr_cad: money(usd * PER_USD.CAD),
    pay_rate_st_hr_eur: money(usd * PER_USD.EUR),
    pay_rate_st_hr_gbp: money(usd * PER_USD.GBP),
    pay_rate_st_hr_inr: money(usd * PER_USD.INR),
  };
};

/**
 * Where an assignment's pay lands against its band. Mostly inside, with a tail
 * above max and a smaller one below min, and a little geographic lift so the
 * regional report has a gradient to show.
 */
const payAgainst = ({ min, max }, placeFactor) => {
  const position = weighted([['inside', 80], ['above', 13], ['below', 7]]);
  const lift = 1 + (placeFactor - 1) * 0.5;
  if (position === 'above') return max * between(1.02, 1.2);
  if (position === 'below') return min * between(0.84, 0.98);
  return Math.min(max, Math.max(min, between(min, max) * lift));
};

const makeAssignment = ({ code, account, country, role, title, cardBand, year }) => {
  const geo = COUNTRY[country];
  const [state, city, market, placeFactor] = pick(geo.places);
  const pay = money(cardBand ? payAgainst(cardBand, placeFactor) : role.pay * geo.factor * between(0.95, 1.4) * placeFactor);
  const drifted = rand() < 0.3;
  const initial = drifted ? money(pay / between(1.02, 1.09)) : pay;
  const [supplier, preferred, tier] = weighted([[SUPPLIERS[0], 4], [SUPPLIERS[1], 3], [SUPPLIERS[2], 2], [SUPPLIERS[3], 2], [SUPPLIERS[4], 2], [SUPPLIERS[5], 1], [SUPPLIERS[6], 1]]);
  const markup = preferred === 'Non-Preferred' ? between(1.45, 1.6) : between(1.32, 1.46);
  const bill = money(pay * markup);
  const templateMax = cardBand ? money(cardBand.max * 1.45) : money(pay * between(1.45, 1.7));
  const isOpen = year === '2026' ? (rand() < 0.75 ? 1 : 0) : year === '2025' ? (rand() < 0.3 ? 1 : 0) : 0;
  const hours = Math.round(year === '2024' ? between(400, 2080) : year === '2025' ? between(200, 1900) : between(40, 1300));
  const labor = role.collar === 'Blue' ? 'Light Industrial' : 'Professional';
  const sow = rand() < 0.06;

  return {
    assignment_unique_key: `ASG-${code}-${serial++}`,
    snapshot_months: 1,
    rsr_client_code: code,
    account_name: account,
    title_cleaned: title,
    ms_category_1: role.cat,
    ms_category_2: `${role.cat} - ${role.collar === 'Blue' ? 'Operations' : 'Professional Services'}`,
    soc_broad_group: role.soc,
    onet_detailed_occupation: role.onet,
    rsr_labor_type: labor,
    contingent_vs_sow: sow ? 'SOW' : 'Contingent',
    collar_type: role.collar === 'Blue' ? 'Blue Collar' : 'White Collar',
    specialization: role.cat,
    rsr_country: geo.domo,
    state_province: state,
    city,
    market,
    rsr_region: geo.region,
    pay_rate_st_hr: pay,
    pay_rate_st_hr_initial: initial,
    bill_rate_st_hr: bill,
    ...fx(pay, geo.currency),
    max_template_bill_rate_st_hr: templateMax,
    compliance_vs_max_template_bill_rate: bill <= templateMax ? 'Compliant' : 'Non-Compliant',
    card_year: year,
    pay_drift: money(pay - initial),
    pay_drift_pct: initial ? Math.round(((pay - initial) / initial) * 10000) / 10000 : null,
    pay_dollars: money(pay * hours),
    bill_dollars: money(bill * hours),
    hours_to_date: hours,
    currency: geo.currency,
    assignment_status: isOpen ? 'Active' : 'Completed',
    is_open: isOpen,
    extended: drifted || rand() < 0.1 ? 1 : 0,
    rsr_supplier: supplier,
    preferred_supplier_status: preferred,
    supplier_category: tier,
  };
};

const yearWeights = (client) =>
  client.key === 'northwind' ? [['2024', 3], ['2025', 4], ['2026', 5]] : client.key === 'fabrikam' ? [['2026', 1]] : [['2025', 4], ['2026', 5]];

for (const client of CLIENTS) {
  // Volume is skewed: a few roles carry most of the hours, as in real programs.
  const roleWeights = client.roles.map((name, i) => [name, 1 / (1 + i * 0.35)]);
  for (let n = 0; n < client.assignments; n++) {
    const country = weighted(client.countries.map((c, i) => [c, i === 0 ? 6 : 2]));
    const year = weighted(yearWeights(client));

    if (client.uncarded.length && rand() < 0.07) {
      const wanted = pick(client.uncarded);
      const role = UNCARDED.find((u) => u.name === wanted);
      actuals.push(makeAssignment({ code: client.code, account: client.account, country, role, title: role.actual, year }));
      continue;
    }

    const roleName = weighted(roleWeights);
    const role = roleByName.get(roleName);
    const cardBand = band(client, country, roleName, year) ?? band(client, country, roleName, '2026');
    // About two in three assignments carry the card's own spelling.
    const title = rand() < 0.65 ? role.card : role.actual;
    actuals.push(makeAssignment({ code: client.code, account: client.account, country, role, title, cardBand, year }));
  }
}

const allRoles = [...ROLES, ...UNCARDED];
for (const other of OTHER_ACCOUNTS) {
  for (let n = 0; n < other.assignments; n++) {
    const role = pick(allRoles);
    const country = pick(other.countries);
    actuals.push(makeAssignment({ code: other.code, account: other.account, country, role, title: role.actual, year: pick(['2025', '2026']) }));
  }
}

// ---------------------------------------------------------------------------
// Client directory: one row per client per country, as the dataflow emits it.
// ---------------------------------------------------------------------------

const directory = [];
const accounts = [
  ...CLIENTS.map((c) => ({ code: c.code, account: c.account, countries: c.countries })),
  ...OTHER_ACCOUNTS,
];
for (const a of accounts) {
  for (const country of a.countries) {
    const rows = actuals.filter((r) => r.rsr_client_code === a.code && r.rsr_country === COUNTRY[country].domo);
    const hours = rows.reduce((s, r) => s + r.hours_to_date, 0);
    directory.push({
      rsr_client_code: a.code,
      account_name: a.account,
      rsr_country: COUNTRY[country].domo,
      hours_sum: hours || Math.round(between(500, 4000)),
      month_max: rows.length ? '2026-09-01' : pick(['2025-11-01', '2026-02-01']),
    });
  }
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

function toCsv(lines) {
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return lines.map((l) => l.map(cell).join(',')).join('\n') + '\n';
}
const objectsToCsv = (rows) => toCsv([Object.keys(rows[0]), ...rows.map((r) => Object.values(r))]);

fs.writeFileSync(path.join(OUT, 'domo_rate_card_client_directory.csv'), objectsToCsv(directory));
fs.writeFileSync(path.join(OUT, 'domo_rate_card_actuals_assignment.csv'), objectsToCsv(actuals));
fs.writeFileSync(path.join(OUT, 'local_seed_client_directory.json'), JSON.stringify(directory));
fs.writeFileSync(path.join(OUT, 'local_seed_actuals_assignment.json'), JSON.stringify(actuals));

console.log(`Wrote ${fs.readdirSync(OUT).length} files to ${OUT}`);
console.log(`  ${directory.length} client directory rows, ${actuals.length} assignments`);
