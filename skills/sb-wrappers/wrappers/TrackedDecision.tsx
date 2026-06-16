/**
 * TrackedDecision — decision metadata banner.
 *
 * Wraps any composition with a colored banner showing decision state
 * (pending / chosen / rejected), rationale, reviewers, and target date.
 * Hooks into the DecisionsDashboard via the matching `decision:*` tag on
 * the story.
 *
 * @example
 * <TrackedDecision
 *   id="hero-v2-2026-05-27"
 *   status="pending"
 *   rationale="Static image vs animated shader background"
 *   reviewers={['design-lead', 'pm-marketing']}
 *   target="2026-06-03"
 * >
 *   <ABCanvas variants={[...]} />
 * </TrackedDecision>
 *
 * Storybook-only — never imported from app code.
 */
import type { ReactNode } from 'react';

export type DecisionStatus = 'pending' | 'chosen' | 'rejected';

export interface TrackedDecisionProps {
  id: string;
  status: DecisionStatus;
  /** One-line description of what's being decided */
  rationale?: string;
  reviewers?: string[];
  /** ISO date string the decision is due by */
  target?: string;
  /** Once status='chosen', the winning variant label */
  winner?: string;
  /** ISO date string the decision was made */
  date?: string;
  children: ReactNode;
}

const STYLES: Record<DecisionStatus, { bg: string; border: string; badge: string }> = {
  pending:  { bg: 'var(--color-warning-surface, #fef3c7)', border: 'var(--color-warning, #f5d77a)', badge: 'var(--color-warning-text, #d97706)' },
  chosen:   { bg: 'var(--color-success-surface, #dcfce7)', border: 'var(--color-success, #86efac)', badge: 'var(--color-success-text, #15803d)' },
  rejected: { bg: 'var(--color-error-surface, #fee2e2)', border: 'var(--color-error, #fca5a5)', badge: 'var(--color-error-text, #b91c1c)' },
};

const BADGE_LABEL: Record<DecisionStatus, string> = {
  pending:  'Pending',
  chosen:   'Chosen',
  rejected: 'Rejected',
};

export function TrackedDecision({
  id,
  status,
  rationale,
  reviewers,
  target,
  winner,
  date,
  children,
}: TrackedDecisionProps): JSX.Element {
  const s = STYLES[status];
  return (
    <div className="tracked-decision" data-decision-id={id} data-decision-status={status}>
      <div
        className="decision-banner"
        style={{
          background: s.bg,
          border: `1px solid ${s.border}`,
          borderRadius: '8px 8px 0 0',
          padding: '0.8rem 1.2rem',
          borderBottom: 'none',
        }}
      >
        <span
          className="decision-badge"
          style={{
            display: 'inline-block',
            fontSize: '0.7rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            padding: '0.15rem 0.5rem',
            borderRadius: 3,
            background: s.badge,
            color: 'white',
            marginRight: '0.6rem',
          }}
        >
          {BADGE_LABEL[status]}
        </span>
        <strong>{id}</strong>
        {winner && status === 'chosen' && <> · Winner: <strong>{winner}</strong></>}
        <div style={{ fontSize: '0.78rem', color: 'var(--color-muted-foreground, #666)', marginTop: '0.3rem' }}>
          {rationale && <div>{rationale}</div>}
          <div>
            {reviewers && reviewers.length > 0 && (
              <>Reviewers: {reviewers.map((r) => <code key={r}>{r}</code>).reduce((acc: ReactNode[], el, i) => acc.length ? [...acc, ', ', el] : [el], [])} · </>
            )}
            {target && status === 'pending' && <>Target: <strong>{target}</strong></>}
            {date && status !== 'pending' && <>Decided: <strong>{date}</strong></>}
          </div>
        </div>
      </div>
      <div
        className="decision-content"
        style={{
          border: `1px solid ${s.border}`,
          borderTop: 'none',
          padding: '1rem',
          borderRadius: '0 0 8px 8px',
        }}
      >
        {children}
      </div>
    </div>
  );
}
