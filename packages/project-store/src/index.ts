import type { MotionDocument, OperationPreparation, OperationPreparationRequest,
  WorkspaceProjection } from '../../domain/src/index.ts';
import type { ActiveClaimList, ActivityPage, BranchList, CommandFailure, CommandSuccess, CommitMetadata,
  ImmutableRevision, MotionCommand, RequestAuth } from '../../motion-protocol/src/index.ts';

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
  snapshot(): unknown; backup(destinationPath: string): void; close(): void;
}
