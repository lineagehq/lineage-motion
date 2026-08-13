import type { MotionDocument } from '../../domain/src/index.ts';
import type { CommandFailure, CommandSuccess, CommitMetadata, ImmutableRevision, MotionCommand } from '../../motion-protocol/src/index.ts';

export type CommitResult = { response: CommandSuccess; event: CommitMetadata; replayed: boolean } | { response: CommandFailure };

export interface ProjectStore {
  initialize(seed: MotionDocument): void;
  compareAndCommit(command: MotionCommand): CommitResult;
  readHead(documentId: string): ImmutableRevision | null;
  readRevision(documentId: string, revision: number): ImmutableRevision | null;
  snapshot(): unknown;
  backup(destinationPath: string): void;
  close(): void;
}
