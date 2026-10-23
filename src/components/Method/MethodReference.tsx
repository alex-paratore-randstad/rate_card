import React from 'react';
import {
  Filter,
  Scale,
  Sigma,
  Link2,
  Tags,
  ShieldCheck,
  Gauge,
  Map as MapIcon,
  FileWarning,
  SlidersHorizontal,
  TableProperties,
  TrendingUp,
  Target,
} from 'lucide-react';
import * as ClientMatch from '../../services/clientMatchService';
import * as TitleMatch from '../../services/titleMatchService';
import * as Regional from '../../services/regionalService';
import * as CardQuality from '../../services/cardQualityService';

/**
 * What the tool computes, and why it computes it that way.
 *
 * Every tuning threshold is imported from the service that enforces it rather
 * than written out again. A reference that restates its numbers drifts from the
 * code the first time one is tuned, and a stale reference is worse than none —
 * someone checks a figure against it and comes away confident and wrong.
 *
 * The score ladders are the exception and say so on the page: those literals
 * live inside the scoring functions rather than as named constants, so they are
 * shown to explain the shape rather than as a guarantee.
 *
 * The sections deliberately record the *rejected* method alongside the chosen
 * one. Most of these calculations have an obvious version that is wrong in a
 * way the output does not reveal, and the reason a number is trustworthy is
 * usually that something plausible was ruled out.
 */

const pct = (v: number) => `${Math.round(v * 100)}%`;

const Formula: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <pre
    style={{
      margin: '8px 0',
      padding: '12px 14px',
      background: 'var(--surface-container-low)',
      border: '1px solid var(--ghost-border)',
      borderLeft: '3px solid var(--randstad-blue-primary)',
      borderRadius: 'var(--radius-sm)',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: '0.82rem',
      lineHeight: 1.7,
      overflowX: 'auto',
      color: 'var(--on-surface)',
      whiteSpace: 'pre',
    }}
  >
    {children}
  </pre>
);

/** One calculation: what it answers, how, and what was ruled out. */
const Calc: React.FC<{
  name: string;
  answers: string;
  children: React.ReactNode;
  instead?: React.ReactNode;
}> = ({ name, answers, children, instead }) => (
  <div
    style={{
      paddingBottom: '18px',
      marginBottom: '18px',
      borderBottom: '1px solid var(--ghost-border)',
    }}
  >
    <h3 style={{ margin: '0 0 2px' }}>{name}</h3>
    <div className="text-meta" style={{ marginBottom: '8px' }}>
      {answers}
    </div>
    {children}
    {instead && (
      <div
        style={{
          marginTop: '10px',
          paddingLeft: '14px',
          borderLeft: '3px solid var(--status-warning)',
          fontSize: '0.9rem',
          color: 'var(--on-surface-muted)',
        }}
      >
        <strong style={{ color: 'var(--on-surface)' }}>Not the obvious way, because:</strong>{' '}
        {instead}
      </div>
    )}
  </div>
);

const Section: React.FC<{
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}> = ({ icon, title, subtitle, children }) => (
  <div className="tonal-card">
    <div className="card-header-row">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
        {icon}
        <div>
          <h2>{title}</h2>
          <span className="app-subtitle">{subtitle}</span>
        </div>
      </div>
    </div>
    {children}
  </div>
);

export const MethodReference: React.FC = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
    <div className="tonal-card">
      <h2>How the numbers are calculated</h2>
      <p style={{ maxWidth: '70ch', color: 'var(--on-surface-muted)', marginTop: '6px' }}>
        A reference for anyone about to quote a figure from this tool. Every tuning threshold —
        everything in the table at the foot of this page — is read from the service that
        enforces it, so those cannot fall out of step with the reports. The score ladders are
        written out to explain the shape of the scoring, and are the one thing here worth
        checking against the code if a match ever behaves unexpectedly.
      </p>
      <div className="note">
        <strong>The uploaded rate card decides what exists.</strong> An assignment appears in a
        report only if the card covers its client, its country, its rate year and its title.
        That is why an unresolved client removes all of its data rather than some of it, and why
        coverage and compliance always describe the same population — they share one scoping
        function.
      </div>
    </div>

    <Section
      icon={<TableProperties size={20} color="var(--randstad-blue-primary)" />}
      title="Rate card and variance"
      subtitle="The uploaded card on its own. No Domo data is involved in anything here."
    >
      <Calc
        name="Rate per role"
        answers="What does the card say this role pays?"
        instead={
          <>
            picking the first matching record would be arbitrary. A card commonly carries several
            rows for one title — one per region, say — and whichever happened to sort first would
            become the card's answer, changing with the file's row order rather than with the
            rates.
          </>
        }
      >
        <Formula>{`row key   = jobTitle + labor type
min, max  = mean of every card record sharing that key, within one rate year`}</Formula>
        The table says so when it has averaged anything, because an averaged band is a summary of
        several bands rather than a band anyone agreed.
      </Calc>

      <Calc
        name="Variance"
        answers="How did the rate move between two years?"
        instead={
          <>
            measuring every year against the first selected one answers a different question —
            cumulative drift from a baseline rather than this year's movement. Year over year was
            chosen because it is the number that reads the same whichever years happen to be
            loaded.
          </>
        }
      >
        <Formula>{`variance = (this year − previous year) ÷ previous year

measured against the previous SELECTED year, not the first:
  2025 → 2026 → 2027  gives  (2026 vs 2025) and (2027 vs 2026)`}</Formula>
        Reported on the minimum and the maximum separately. A card whose minimum rose while its
        maximum held is a real change, and a max-only variance — which is what the source
        workbook's <code>=(F2-D2)/D2</code> computes — reports it as 0.00%.
      </Calc>

      <Calc name="When variance is not shown" answers="Why is there an em-dash instead of 0.00%?">
        <Formula>{`null when  the role is absent from either year
           or the earlier year's rate is zero`}</Formula>
        Rendered as an em-dash. <code>0.00%</code> would read as &ldquo;no change&rdquo;, which is
        a much more reassuring claim than &ldquo;not comparable&rdquo;.
      </Calc>

      <Calc name="Which upload counts" answers="A year was uploaded twice — which one is shown?">
        <Formula>{`supersede key = rateYear + client + country
the newest uploadedAt for each key wins`}</Formula>
        Client and country are in the key deliberately. Keyed on the year alone, a file covering
        only the US would supersede every other market's records for that year and silently drop
        them. Superseded records stay stored, and the Records tab shows them.
      </Calc>
    </Section>

    <Section
      icon={<Filter size={20} color="var(--randstad-blue-primary)" />}
      title="What gets into a report"
      subtitle="Four gates, applied in order. Anything turned away is counted with its reason."
    >
      <Calc name="Client" answers="Which assignments belong to this card?">
        <Formula>{`card.client → confirmed alias → rsr_client_code
match on the code, never on the name`}</Formula>
        The uploaded card says <code>Xerox</code>; Domo says <code>Xerox Corporation</code>. The
        pairing is resolved once by a person and stored, so no report re-guesses it.
      </Calc>

      <Calc name="Country and currency" answers="Which market, and priced in what?">
        <Formula>{`country → ISO code       ("USA", "UNITED STATES OF AMERICA" → US)
ISO code → currency      (US, PR → USD · CA → CAD · GB → GBP)
currency → rate column   (pay_rate_st_hr_usd, _cad, _eur, _gbp, _inr)`}</Formula>
        A rate card carries no currency of its own, so it is inferred from the country. Puerto
        Rico is its own market but prices in US dollars. A country with no conversion column
        available is excluded rather than compared at its local rate.
      </Calc>

      <Calc name="Rate year" answers="Which year's bands apply?">
        <Formula>{`card.rateYear === assignment.card_year
card_year = YEAR(assignment_original_start_date)`}</Formula>
        An assignment is judged against the card in force when it started, not the current one.
      </Calc>

      <Calc
        name="Title"
        answers="Which band belongs to this work?"
        instead={
          <>
            exact string matching alone left most work unjoined, and a title that failed to match
            was indistinguishable from work nobody had priced. The matcher makes that difference
            explicit.
          </>
        }
      >
        <Formula>{`normalise(card.jobTitle) === normalise(title_cleaned)
  or a confirmed match redirects the card onto the actuals title`}</Formula>
      </Calc>
    </Section>

    <Section
      icon={<Sigma size={20} color="var(--randstad-blue-primary)" />}
      title="How rates are averaged"
      subtitle="Every average in the tool is weighted by hours."
    >
      <Calc
        name="Weighted rate"
        answers="What is this title actually paid?"
        instead={
          <>
            a plain mean counts a three-week assignment the same as a two-year one. On the test
            fixture, 2,000 hrs at $70 and 500 hrs at $80 average to $75.00 unweighted and{' '}
            <strong>$72.00</strong> weighted.
          </>
        }
      >
        <Formula>{`weighted rate = Σ(rate × hours) ÷ Σ(hours)`}</Formula>
      </Calc>

      <Calc
        name="Why not the ETL's pay_dollars"
        answers="There is a pre-multiplied column — why is it recomputed?"
      >
        <Formula>{`pay_dollars (from the dataflow) = pay_rate_st_hr × hours_to_date
                                 ↑ local currency`}</Formula>
        Comparisons happen in the card's currency. Using that column alongside a converted rate
        would mix converted rates with unconverted money and produce an average denominated in
        nothing. Every weighted figure here recomputes from the converted rate.
      </Calc>
    </Section>

    <Section
      icon={<Link2 size={20} color="var(--randstad-blue-primary)" />}
      title="Client matching"
      subtitle="Scoring proposes; a person decides."
    >
      <Calc name="Normalisation" answers="What counts as the same name?">
        <Formula>{`lowercase · strip accents · "&" → "and" · drop punctuation
drop legal suffixes  (inc, corp, ltd, llc, gmbh, plc, …)
keep qualifiers      (holdings, global, group, usa)`}</Formula>
        Qualifiers stay because &ldquo;Acme Holdings&rdquo; and &ldquo;Acme Group&rdquo; can be
        different accounts.
      </Calc>

      <Calc name="Score" answers="How close are two names?">
        <Formula>{`identical after normalisation          1.00
same but for spacing                  0.97
every word of one inside the other    0.80 + 0.15 × (shorter ÷ longer)
initials match in full                0.90      ("IBM" → International Business Machines)
initials match the start              0.72      ("HP" → Hewlett Packard Enterprise)
otherwise            0.45 × word overlap + 0.55 × character overlap`}</Formula>
        The acronym rule only fires when the short side was written in capitals, or is three
        letters or fewer — otherwise a five-letter word matched any five-word company on its
        initials.
      </Calc>

      <Calc name="When it decides for you" answers="What resolves without being asked?">
        <Formula>{`auto-accept   score ≥ ${ClientMatch.AUTO_RESOLVE_SCORE} and no close runner-up
propose       score ≥ ${ClientMatch.SUGGEST_FLOOR}
ambiguous     top two within ${ClientMatch.AMBIGUOUS_MARGIN}`}</Formula>
        Two candidates scoring alike is a question for a person, including two that both score
        1.00 — that means one name sits under two client codes.
      </Calc>

      <Calc
        name="One candidate per client code"
        answers="Why does a client operating in four countries appear once?"
        instead={
          <>
            the directory emits a row per client per country. Shown separately they scored
            identically, tripped the ambiguity check, and split the hours a reviewer judges by —
            while the thing being chosen between was the same code either way.
          </>
        }
      >
        <Formula>{`collapse on rsr_client_code
hours summed · countries listed as context`}</Formula>
      </Calc>
    </Section>

    <Section
      icon={<Tags size={20} color="var(--randstad-blue-primary)" />}
      title="Title matching"
      subtitle="Same shape as client matching, with two signals a name does not have."
    >
      <Calc name="Normalisation" answers="What counts as the same title?">
        <Formula>{`sr. / snr → senior      jr → junior      mgr → manager
II → 2   III → 3         qa → quality assurance
"Software Engineer" and "Software Developer" stay different`}</Formula>
        Formatting only. Deciding that two different words mean one role is a judgement, and
        judgements go through the queue.
      </Calc>

      <Calc name="Score adjustments" answers="What beyond spelling informs a match?">
        <Formula>{`shared occupational group   +${TitleMatch.TAXONOMY_BONUS}
pay outside the card band   −${TitleMatch.BAND_MISMATCH_PENALTY}   (tolerance ±${pct(TitleMatch.BAND_TOLERANCE)} of band width)

auto-accept ≥ ${TitleMatch.AUTO_RESOLVE_SCORE} · propose ≥ ${TitleMatch.SUGGEST_FLOOR} · ambiguous within ${TitleMatch.AMBIGUOUS_MARGIN}`}</Formula>
        Both are bounded so neither carries a match alone. A SOC group covers hundreds of
        titles; a coincidentally similar rate says nothing by itself. Together they separate{' '}
        <em>Scrum Master</em> from <em>Scrum Master Intern</em>: the words score 86%, the $12/hr
        against a $55&ndash;80 band pulls it to 76%.
      </Calc>

      <Calc name="Queue order" answers="Which title should be reviewed first?">
        <Formula>{`rank by hours the match would bring into coverage`}</Formula>
        Nobody works through several hundred titles alphabetically, so the first screenful has to
        be the part that pays.
      </Calc>
    </Section>

    <Section
      icon={<Tags size={20} color="var(--randstad-blue-primary)" />}
      title="Standard titles"
      subtitle="Every card title matched to the uploaded standard list. Not the same thing as title matching, above."
    >
      <Calc
        name="What it is"
        answers="How does this differ from the title matcher?"
        instead={
          <>
            storing both in one place would have forced a compromise. A match to Domo is a
            judgement about two systems and is only safe per client; the standard list is a
            taxonomy decided elsewhere and holds everywhere. Merging them would mean either scoping
            the taxonomy per client for no reason, or widening a per-client match to every account.
          </>
        }
      >
        <Formula>{`title matching   card title  →  Domo title_cleaned   per client, confirmed before use
standard titles  card title  →  standard title      global, applied at once, reviewed after`}</Formula>
        The two are stored separately and neither reads the other. Only the matcher feeds the
        Domo-backed reports; the standard titles feed Rate Movement.
      </Calc>

      <Calc name="Seniority" answers="Why does Senior Software Engineer II match Software Engineer?">
        <Formula>{`key   = normalise(title)          Sr. → senior, II → 2, punctuation dropped
level = senior junior lead principal staff mid trainee 1–5 …   taken off, kept as the level
noise = contract temp remote part time …                      taken off, discarded`}</Formula>
        The list names roles, not grades, so a grade on the card title is set aside before
        matching and shown beside the match instead.
      </Calc>

      <Calc
        name="Scoring"
        answers="How is the standard title chosen?"
        instead={
          <>
            plain string similarity, which rates <em>Data Analyst</em> close to{' '}
            <em>Data Engineer</em> and <em>Warehouse Associate</em> close to{' '}
            <em>Research Associate</em> — the same words, different jobs.
          </>
        }
      >
        <Formula>{`exact     same key after seniority and synonyms (developer = engineer, rep = representative …)
otherwise 0.7 × word overlap (role noun counts double) + 0.3 × spelling similarity
          × 0.75 if the card's role noun is not in the standard
          × 0.75 if none of the card's other words are

exact             applied
≥ 80%, clear      applied, high confidence
55–80%, or a near tie (< 5 points)  applied, flagged for review
< 55%             not applied; best guesses offered`}</Formula>
      </Calc>

      <Calc
        name="Review"
        answers="What does confirming a match store?"
        instead={
          <>
            storing every automatic match would freeze it: a card uploaded next month, or a revised
            list, would need the whole set re-run by hand.
          </>
        }
      >
        <Formula>{`stored     only reviewed decisions — a confirmed, changed, or "none fits" title
recomputed every automatic match, whenever the cards or the list change
new list   replaces the old one; reviewed decisions are kept`}</Formula>
        Coverage is counted in records rather than distinct titles, because twenty unmapped
        titles carrying one row each matter less than one carrying two hundred.
      </Calc>
    </Section>

    <Section
      icon={<ShieldCheck size={20} color="var(--randstad-blue-primary)" />}
      title="Card coverage"
      subtitle="Which work the card governs. No rates compared."
    >
      <Calc name="The join" answers="Is there a band for this work?">
        <Formula>{`full outer join on (client code, title)

matched        a band and hours agree
actuals-only   hours with no band       → a gap, or an unmatched title
card-only      a band with no hours     → unpriced work, or an unmatched title

covered share = covered hours ÷ (covered + uncovered hours)`}</Formula>
        Built before compliance deliberately: it exercises the joins and computes no verdict, so
        there is evidence the joins hold before a percentage rests on them.
      </Calc>
    </Section>

    <Section
      icon={<Scale size={20} color="var(--randstad-blue-primary)" />}
      title="Card compliance"
      subtitle="Whether work is paid inside the band it was priced at."
    >
      <Calc
        name="Verdict"
        answers="Is this rate inside the band?"
        instead={
          <>
            comparing a title&rsquo;s <em>average</em> to its band lets a high assignment and a
            low one cancel out. On the fixture a title averaging $76.67 sits inside its $60&ndash;90
            band while only a third of its hours are — the average alone reports it compliant.
          </>
        }
      >
        <Formula>{`per assignment:
  rate > max  → above max
  rate < min  → below min
  otherwise   → in band

then sum hours by verdict. Never average first.`}</Formula>
      </Calc>

      <Calc name="Money" answers="What does the variance cost?">
        <Formula>{`excess    = (rate − max) × hours     on assignments above
shortfall = (min − rate) × hours     on assignments below

split by is_open — an open assignment is a decision, a closed one is history`}</Formula>
      </Calc>

      <Calc name="Scattered" answers="Would an average have hidden this?">
        <Formula>{`hours on both sides of the band
  or  hours outside it while the weighted average sits inside`}</Formula>
      </Calc>

      <Calc
        name="Band below / above market"
        answers="Is this a breach, or a stale card?"
        instead={
          <>
            treating every rate above the maximum as a breach. Several independent hiring
            decisions do not all breach a ceiling by coincidence — where the band and the observed
            rates do not overlap at all, the band is the outlier.
          </>
        }
      >
        <Formula>{`band below market   observed minimum > card maximum
band above market   observed maximum < card minimum

excess on those titles is reported separately as not recoverable`}</Formula>
      </Calc>
    </Section>

    <Section
      icon={<Gauge size={20} color="var(--randstad-teal)" />}
      title="VMS ceiling"
      subtitle="Independent of the card, and the one check with a second opinion."
    >
      <Calc name="Verdict" answers="Is the bill rate over the ceiling the VMS enforces?">
        <Formula>{`bill_rate_st_hr > max_template_bill_rate_st_hr

both columns sit on the same row in the same currency,
so no conversion and no title matching are needed`}</Formula>
        Hours-based figures therefore hold across the whole scope; money is reported per currency
        and never summed across them.
      </Calc>

      <Calc name="Reading the source's own verdict" answers="Does Domo agree?">
        <Formula>{`compliance_vs_max_template_bill_rate

"non-compliant" is tested before "compliant"
an unrecognised value is reported as unrecognised, not as agreement`}</Formula>
        The negative form contains the positive as a substring — testing the other way round would
        read every violation as a pass. Disagreement is the point of the section.
      </Calc>
    </Section>

    <Section
      icon={<MapIcon size={20} color="var(--randstad-blue-primary)" />}
      title="Regional differentials"
      subtitle="Whether a national band describes the market."
    >
      <Calc
        name="Differential"
        answers="What does this region pay relative to the rest?"
        instead={
          <>
            comparing a region&rsquo;s average rate to the national average measures which roles
            that region staffs. On a fixture where one state held the senior title and another the
            junior, that method called the first <strong>108%</strong> more expensive when the real
            geographic difference was <strong>10%</strong>.
          </>
        }
      >
        <Formula>{`per title:
  region rate  = Σ(rate × hours) ÷ Σ(hours)   within that region
  baseline     = median of regions clearing the volume bar
  differential = region rate ÷ baseline`}</Formula>
        The baseline is the median rather than the title&rsquo;s overall weighted rate, so the
        region holding most of the hours cannot define the line it is judged against, and a thin
        cell cannot move it.
      </Calc>

      <Calc name="Volume bar" answers="When is a region measured rather than guessed?">
        <Formula>{`${Regional.MIN_ASSIGNMENTS} assignments and ${Regional.MIN_HOURS} hours in that title

thin cells are shown and marked, but never reach an index or a band`}</Formula>
        One assignment is a single negotiation, not a market rate.
      </Calc>

      <Calc name="Index and suggested tier" answers="What would a regional band be?">
        <Formula>{`index = Σ(differential × hours) ÷ Σ(hours)   across titles

suggested band = national band × index

reliable only when 2 or more titles contribute
tiers matter when the spread exceeds ${pct(Regional.MATERIAL_SPREAD)}`}</Formula>
      </Calc>
    </Section>

    <Section
      icon={<FileWarning size={20} color="var(--status-error)" />}
      title="Card quality checks"
      subtitle="Run at upload, on the Reports tab, and again on the compliance tab."
    >
      <Calc name="Structural checks" answers="Is the band usable at all?">
        <Formula>{`min > max        columns mapped the wrong way round
min = max        no width; only one exact rate passes
min or max ≤ 0   nothing to compare against
max ÷ min > ${CardQuality.IMPLAUSIBLE_RATIO}   too wide to govern anything`}</Formula>
      </Calc>
    </Section>

    <Section
      icon={<TrendingUp size={20} color="var(--randstad-blue-primary)" />}
      title="Rate movement"
      subtitle="What moved between two rate years. On the Reports tab; no Domo data involved."
    >
      <Calc
        name="Change in NTE"
        answers="Where did the card maximum rise, and by how much?"
      >
        <Formula>{`line   = client + country + title + labor type
change = max(to year) ÷ max(from year) − 1, per line in both years
cell   = mean change of the lines in that row and region`}</Formula>
        Compared line by line, then averaged, never averaged and then compared: a region that
        added a senior title would otherwise show a rise nobody negotiated. Lines in only one
        year are counted and left out. Every line counts once — the card has no volume, so the
        figure is not spend-weighted. Rows are standard titles where a card title has one, and the
        card title where it does not; regions group whole countries.
      </Calc>
    </Section>

    <Section
      icon={<Target size={20} color="var(--randstad-blue-primary)" />}
      title="Rate concentration"
      subtitle="Which roles carry the cost of a rate change. The card change, against Domo spend."
    >
      <Calc
        name="Role position"
        answers="How much did a role's maximum move, and how much is spent on it?"
      >
        <Formula>{`change  = Σ (line change × line spend) ÷ Σ line spend, per role
spend   = Σ bill_dollars × (pay_rate_st_hr_usd ÷ pay_rate_st_hr), in USD
workers = open assignments
impact  = spend × change`}</Formula>
        Lines pair across years exactly as in rate movement, then join to the actuals on client
        code, country, and title through the confirmed client and title matches. A role is its
        standard title. The actuals carry no USD bill amount, so each row&apos;s own pay-rate
        conversion is its exchange rate; a row with neither is left out and counted. Spend is to
        date, not trailing twelve months: the dataset has no reporting month to window by.
      </Calc>
      <Calc name="Watch list" answers="Where should rates be agreed first?">
        <Formula>{`change > spend-weighted portfolio change
spend  ≥ median role spend
ranked by impact`}</Formula>
      </Calc>
    </Section>

    <Section
      icon={<SlidersHorizontal size={20} color="var(--on-surface-muted)" />}
      title="Every threshold in one place"
      subtitle="Read live from the services, so this table cannot go stale."
    >
      <div className="table-container">
        <table className="randstad-table">
          <thead>
            <tr>
              <th>Where</th>
              <th>Threshold</th>
              <th style={{ textAlign: 'right' }}>Value</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['Client matching', 'Auto-accept at or above', ClientMatch.AUTO_RESOLVE_SCORE],
              ['Client matching', 'Propose at or above', ClientMatch.SUGGEST_FLOOR],
              ['Client matching', 'Ambiguous within', ClientMatch.AMBIGUOUS_MARGIN],
              ['Title matching', 'Auto-accept at or above', TitleMatch.AUTO_RESOLVE_SCORE],
              ['Title matching', 'Propose at or above', TitleMatch.SUGGEST_FLOOR],
              ['Title matching', 'Ambiguous within', TitleMatch.AMBIGUOUS_MARGIN],
              ['Title matching', 'Shared occupational group bonus', TitleMatch.TAXONOMY_BONUS],
              ['Title matching', 'Pay outside band penalty', TitleMatch.BAND_MISMATCH_PENALTY],
              ['Title matching', 'Band tolerance, of band width', TitleMatch.BAND_TOLERANCE],
              ['Regional', 'Minimum assignments per region', Regional.MIN_ASSIGNMENTS],
              ['Regional', 'Minimum hours per region', Regional.MIN_HOURS],
              ['Regional', 'Spread at which tiers matter', Regional.MATERIAL_SPREAD],
              ['Card quality', 'Band width called implausible', CardQuality.IMPLAUSIBLE_RATIO],
            ].map(([where, name, value]) => (
              <tr key={`${where}-${name}`}>
                <td><span className="text-meta">{where as string}</span></td>
                <td>{name as string}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                  {value as number}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  </div>
);
