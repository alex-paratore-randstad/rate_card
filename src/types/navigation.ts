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
  | 'ingest'
  /** Reports, on uploaded data */
  | 'cardquality'
  | 'movement'
  | 'concentration'
  /** Matching, from the uploaded mapping file */
  | 'mappings'
  /** Supplemental Data, everything needing the Domo connection */
  | 'clients'
  | 'titles'
  | 'coverage'
  | 'compliance'
  | 'regional'
  | 'method';
