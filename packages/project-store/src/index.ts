import type { MotionDocument } from '../../domain/src/index.ts';
import type { CommandFailure, CommandSuccess, CommitMetadata, ImmutableRevision, MotionCommand,
  RequestAuth } from '../../motion-protocol/src/index.ts';

export type CommitResult = { response: CommandSuccess; event: CommitMetadata; replayed: boolean }
  | { response: CommandFailure };
export type AuthContext = RequestAuth & { now: number };
export interface ProjectStore {
  initialize(seed: MotionDocument): void;
  execute(command: MotionCommand, auth: AuthContext): CommitResult;
  compareAndCommit(command: MotionCommand, auth?: AuthContext): CommitResult;
  readHead(documentId: string, branchId?: string): ImmutableRevision | null;
  readRevision(documentId: string, revision: number): ImmutableRevision | null;
  snapshot(): unknown; backup(destinationPath: string): void; close(): void;
}
