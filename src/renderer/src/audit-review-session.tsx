import { createContext, useContext, useLayoutEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { AuditReviewSession, type ReviewSource } from './audit-review-model';

const ReviewContext = createContext<AuditReviewSession | null>(null);
export function AuditReviewProvider({ sessionKey, sources, children }: {
  sessionKey: string; sources: readonly ReviewSource[]; children: ReactNode;
}) {
  // Dashboard remounts on credential changes; marketplace/mode changes replace this memory.
  const session = useMemo(() => new AuditReviewSession(sources), [sessionKey]);
  useLayoutEffect(() => { session.ingest(sources); }, [session, sources]);
  return <ReviewContext.Provider value={session}>{children}</ReviewContext.Provider>;
}
export function useAuditReview() {
  const session = useContext(ReviewContext);
  if (!session) throw Error('商品健檢總表必須使用同次 Dashboard 的結果');
  useSyncExternalStore(session.subscribe, session.getRevision, session.getRevision);
  return session;
}
