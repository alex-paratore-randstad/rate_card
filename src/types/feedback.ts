import { TabId } from './navigation';

/**
 * What a piece of feedback is about.
 *
 * Framed around reviewing the data, not entering it: the people giving this
 * feedback are reading the card and the reports, and the useful split for
 * whoever triages it is "the number is wrong" versus "the number is right but
 * I can't tell what it means" versus "I needed something that isn't here".
 * Those land with different owners — the source file, the explanation, the
 * report design — so the category is chosen by the reviewer rather than
 * guessed from the text afterwards.
 */
export type FeedbackCategory =
  | 'data_accuracy'
  | 'clarity'
  | 'missing'
  | 'usability'
  | 'idea'
  | 'positive';

export const FEEDBACK_CATEGORIES: { id: FeedbackCategory; label: string; hint: string }[] = [
  {
    id: 'data_accuracy',
    label: 'Data looks wrong',
    hint: 'A rate, variance or count does not match what you expect',
  },
  {
    id: 'clarity',
    label: 'Hard to interpret',
    hint: 'Unclear what a figure means or how it was worked out',
  },
  {
    id: 'missing',
    label: 'Something missing',
    hint: 'A column, breakdown, filter or comparison you needed',
  },
  {
    id: 'usability',
    label: 'Hard to use',
    hint: 'Layout, search, navigation or speed got in the way',
  },
  { id: 'idea', label: 'Idea', hint: 'Something that would make reviewing easier' },
  { id: 'positive', label: 'Works well', hint: 'Worth keeping as it is' },
];

/** The reviewer's quick verdict on the view, when they gave one. */
export type FeedbackRating = 'useful' | 'not_useful' | '';

export interface FeedbackEntry {
  id?: string;
  /** The screen the feedback was given on. */
  screen: TabId | 'app';
  screenLabel: string;
  /** A specific thing on the screen, such as one rate card row; empty for the whole view. */
  target: string;
  category: FeedbackCategory;
  rating: FeedbackRating;
  comment: string;
  /** The client and country scope in force, since most findings only hold within one. */
  client: string;
  country: string;
  /** Domo user id from the app's query string, when Domo supplied one. */
  userId: string;
  submittedAt: string;
  /** For triage; always 'new' when written from the app. */
  status: 'new' | 'reviewed' | 'actioned' | 'dismissed';
}
