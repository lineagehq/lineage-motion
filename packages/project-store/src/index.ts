import type { MotionDocument, OperationPreparation, OperationPreparationRequest,
  WorkspaceProjection } from '../../domain/src/index.ts';
import type { ActiveClaimList, ActivityPage, BranchList, CommandFailure, CommandSuccess, CommitMetadata,
  ImmutableRevision, MotionCommand, RequestAuth } from '../../motion-protocol/src/index.ts';
import type { AnnotationList, ReviewCommand, ReviewEvent, ReviewFailure, ReviewResponse,
  RevisionComparison } from '../../motion-protocol/src/review.ts';
import type { HandoffIdentityInput, HandoffReceipt } from '../../review-domain/src/index.ts';

export type CommitResult = { response: CommandSuccess; event: CommitMetadata; replayed: boolean }
  | { response: CommandFailure };
export type AuthContext = RequestAuth & { now: number };
export interface ProjectStore {
  initialize(seed: MotionDocument): void;
  execute(command: MotionCommand, auth: AuthContext): CommitResult;
  compareAndCommit(command: MotionCommand, auth?: AuthContext): CommitResult;
  readHead(documentId: string, branchId?: string): ImmutableRevision | null;
  readRevision(documentId: string, revision: number): ImmutableRevision | null;
  readEvents(documentId: string, afterCommitSeq: number): CommitMetadata[];
  validate(command: MotionCommand, auth: AuthContext): { ok: true } | CommandFailure;
  prepareOperation(request: OperationPreparationRequest): OperationPreparation | null;
  readWorkspace(documentId: string, branchId: string): WorkspaceProjection | null;
  listBranches(documentId: string): BranchList | null;
  listActiveClaims(documentId: string, now: number): ActiveClaimList | null;
  listActivity(documentId: string, afterCommitSeq: number, limit: number): ActivityPage | null;
  executeReview(command: ReviewCommand, auth: AuthContext): { response: ReviewResponse; event?: ReviewEvent; replayed?: boolean };
  listAnnotations(documentId: string, branchId: string): AnnotationList | null;
  readReviewEvents(documentId: string, afterReviewSeq: number): ReviewEvent[];
  compareRevisions(documentId: string, left: number, right: number): RevisionComparison | null;
  createHandoff(operationId: string, input: Omit<HandoffIdentityInput, 'annotationSnapshotVersion' | 'annotationSnapshotDigest'>,
    auth: AuthContext): HandoffReceipt | ReviewFailure;
  snapshot(): unknown; backup(destinationPath: string): void; close(): void;
}
