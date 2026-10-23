/**
 * The set of screens the app can show.
 *
 * Its own file because three places need it — the navigation that renders the
 * tabs, the context that holds the current one, and the layout that routes on
 * it — and the union was previously written out longhand in each. A fourth
 * copy would have been the one that drifted.
 *
 * These are flat ids, not group-plus-member pairs. Tabs are *presented* in
 * groups, but a group is only a heading over its members; everything that
 * routes or remembers a screen deals in these ids alone.
 */
export type TabId =
  /** Command Center */
  | 'dashboard'
  | 'collection'
  /** Reports */
  | 'cardquality'
  | 'movement'
  | 'concentration'
  | 'regional'
  /** Data: ingest, matching, and the coverage and compliance checks */
  | 'ingest'
  | 'mappings'
  | 'clients'
  | 'titles'
  | 'coverage'
  | 'compliance'
  | 'method';
