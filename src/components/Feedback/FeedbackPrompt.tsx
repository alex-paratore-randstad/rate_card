import React, { useState } from 'react';
import { MessageSquarePlus, ThumbsUp, ThumbsDown, CheckCircle2, X } from 'lucide-react';
import { useRateCard } from '../../context/RateCardContext';
import { TAB_GROUPS } from '../Navigation';
import { saveFeedback } from '../../services/domoService';
import { toDomoDateTime } from '../../utils/formatters';
import {
  FEEDBACK_CATEGORIES,
  FeedbackCategory,
  FeedbackRating,
} from '../../types/feedback';
import { TabId } from '../../types/navigation';

/**
 * Feedback from people reviewing the data.
 *
 * Three ways in, one form behind them: a strip at the foot of each review
 * screen, a dialog from the header for anything anywhere, and a dialog from a
 * single rate card row when it is one number that looks off. Every submission
 * carries the screen and the client/country scope it was given under, because
 * "this variance is wrong" means nothing without knowing which card was on
 * screen.
 */

const screenLabel = (tab: TabId): string =>
  TAB_GROUPS.flatMap((g) => g.members).find((m) => m.id === tab)?.label ?? tab;

/** Domo passes the viewer's id on the app's query string; absent in local dev. */
const domoUserId = (): string => {
  try {
    return new URLSearchParams(window.location.search).get('userId') ?? '';
  } catch {
    return '';
  }
};

interface FeedbackFormProps {
  /** A specific thing being commented on; omit for the whole screen. */
  target?: string;
  initialCategory?: FeedbackCategory;
  initialRating?: FeedbackRating;
  /** Shown above the categories in place of the default question. */
  prompt?: string;
  onDone?: () => void;
  onCancel?: () => void;
}

export const FeedbackForm: React.FC<FeedbackFormProps> = ({
  target = '',
  initialCategory,
  initialRating = '',
  prompt,
  onDone,
  onCancel,
}) => {
  const { activeTab, filters } = useRateCard();
  const [category, setCategory] = useState<FeedbackCategory | null>(initialCategory ?? null);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedTo, setSavedTo] = useState<'domo' | 'local' | null>(null);

  // A rating says enough on its own; without one, the comment is the feedback.
  const canSubmit = !!category && (!!initialRating || comment.trim() !== '') && !saving;

  const submit = async () => {
    if (!category) return;
    setSaving(true);
    setError(null);
    try {
      const where = await saveFeedback({
        screen: activeTab,
        screenLabel: screenLabel(activeTab),
        target,
        category,
        rating: initialRating,
        comment: comment.trim(),
        client: filters.client,
        country: filters.country,
        userId: domoUserId(),
        submittedAt: toDomoDateTime(),
        status: 'new',
      });
      setSavedTo(where);
    } catch (e: any) {
      setError(`Could not save your feedback: ${e?.message ?? e}`);
    } finally {
      setSaving(false);
    }
  };

  if (savedTo) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <span className="status-pill success">
          <CheckCircle2 size={14} />
          Thanks — feedback saved{savedTo === 'local' ? ' in this browser (local dev)' : ''}
        </span>
        {onDone && (
          <button className="btn-secondary" style={{ padding: '6px 14px' }} onClick={onDone}>
            Close
          </button>
        )}
      </div>
    );
  }

  const scope = [filters.client, filters.country].filter((v) => v !== 'ALL').join(' · ');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div>
        <span style={{ fontWeight: 600 }}>{prompt ?? 'What kind of feedback is it?'}</span>
        <div className="text-meta" style={{ marginTop: '2px' }}>
          {screenLabel(activeTab)}
          {target ? ` · ${target}` : ''}
          {scope ? ` · ${scope}` : ''}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {FEEDBACK_CATEGORIES.map((c) => {
          const selected = category === c.id;
          return (
            <button
              key={c.id}
              type="button"
              title={c.hint}
              onClick={() => setCategory(c.id)}
              style={{
                padding: '6px 12px',
                borderRadius: '14px',
                fontSize: '0.8rem',
                fontWeight: 600,
                fontFamily: 'var(--font-heading)',
                cursor: 'pointer',
                border: selected ? 'none' : '1px solid #C2C6D3',
                backgroundColor: selected ? 'var(--randstad-blue-primary)' : 'transparent',
                color: selected ? '#ffffff' : 'var(--on-surface-muted)',
              }}
            >
              {c.label}
            </button>
          );
        })}
      </div>
      {category && (
        <span className="text-meta" style={{ marginTop: '-6px' }}>
          {FEEDBACK_CATEGORIES.find((c) => c.id === category)?.hint}
        </span>
      )}

      <textarea
        className="form-control"
        rows={3}
        placeholder={
          category === 'data_accuracy'
            ? 'Which figure, and what did you expect it to be?'
            : initialRating
            ? 'Anything to add? (optional)'
            : 'What did you notice?'
        }
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        style={{ resize: 'vertical' }}
      />

      {error && <span className="status-pill error">{error}</span>}

      <div style={{ display: 'flex', gap: '10px' }}>
        <button className="btn-primary" disabled={!canSubmit} onClick={submit} style={{ opacity: canSubmit ? 1 : 0.5 }}>
          {saving ? 'Saving…' : 'Send feedback'}
        </button>
        {onCancel && (
          <button className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
};

/**
 * The strip at the foot of a review screen. Collapsed it is one line, so it
 * does not compete with the report above it.
 */
export const FeedbackPrompt: React.FC<{ question?: string }> = ({
  question = 'Was this view useful for your review?',
}) => {
  const [open, setOpen] = useState<null | { rating: FeedbackRating; category?: FeedbackCategory }>(null);

  return (
    <div className="tonal-card" style={{ padding: '14px 20px' }}>
      {open ? (
        <FeedbackForm
          initialRating={open.rating}
          initialCategory={open.category}
          prompt={
            open.rating === 'useful'
              ? 'Glad to hear it — what worked?'
              : open.rating === 'not_useful'
              ? 'What got in the way?'
              : undefined
          }
          onDone={() => setOpen(null)}
          onCancel={() => setOpen(null)}
        />
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <MessageSquarePlus size={18} color="#255CA9" />
          <span style={{ fontWeight: 600 }}>{question}</span>
          <button
            className="btn-secondary"
            style={{ padding: '6px 12px' }}
            onClick={() => setOpen({ rating: 'useful', category: 'positive' })}
          >
            <ThumbsUp size={14} /> Yes
          </button>
          <button
            className="btn-secondary"
            style={{ padding: '6px 12px' }}
            onClick={() => setOpen({ rating: 'not_useful' })}
          >
            <ThumbsDown size={14} /> Not really
          </button>
          <button
            className="btn-secondary"
            style={{ padding: '6px 12px' }}
            onClick={() => setOpen({ rating: '' })}
          >
            Leave a comment
          </button>
        </div>
      )}
    </div>
  );
};

/** The same form in a modal, for the header button and per-row flags. */
export const FeedbackDialog: React.FC<
  Omit<FeedbackFormProps, 'onDone' | 'onCancel'> & { title?: string; onClose: () => void }
> = ({ title = 'Send feedback', onClose, ...form }) => (
  <div className="modal-overlay" onClick={onClose}>
    <div className="modal-content" style={{ maxWidth: '560px' }} onClick={(e) => e.stopPropagation()}>
      <div className="card-header-row">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <MessageSquarePlus size={20} color="#255CA9" />
          <span>{title}</span>
        </h2>
        <button
          onClick={onClose}
          title="Close"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#415E7D' }}
        >
          <X size={18} />
        </button>
      </div>
      <FeedbackForm {...form} onDone={onClose} onCancel={onClose} />
    </div>
  </div>
);
