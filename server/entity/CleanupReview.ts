import { DbAwareColumn, resolveDbType } from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export type CleanupDecision =
  | 'pending'
  | 'kept'
  | 'deleting'
  | 'deleted'
  | 'failed'
  | 'stale';

@Entity()
export class CleanupReview {
  @PrimaryColumn({ type: 'varchar' }) public id: string;
  @Column({ type: 'varchar', unique: true }) public reviewKey: string;
  @Column({ type: 'varchar' }) public mediaType: 'movie' | 'tv';
  @Column({ type: 'integer' }) public tmdbId: number;
  @Column({ type: 'integer', nullable: true }) public seasonNumber:
    | number
    | null;
  @Column({ type: 'varchar' }) public title: string;
  @Column({ type: 'varchar' }) public fingerprint: string;
  @Column({ type: 'text', default: '[]' }) public requesterNames: string;
  @DbAwareColumn({ type: 'datetime' }) public eligibleAt: Date;
  @Column({ type: 'varchar', default: 'pending' })
  @Index()
  public status: CleanupDecision;
  @Column({ type: 'text', nullable: true }) public planJson: string | null;
  @Column({ type: 'varchar', nullable: true }) public planHash: string | null;
  @DbAwareColumn({ type: 'datetime', nullable: true })
  public notifiedAt: Date | null;
  @Column({ type: 'varchar', nullable: true }) public emailError: string | null;
  @Column({ type: 'integer', nullable: true }) public decidedBy: number | null;
  @DbAwareColumn({ type: 'datetime', nullable: true })
  public decidedAt: Date | null;
  @Column({ type: 'text', nullable: true }) public lastError: string | null;
  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;
  @UpdateDateColumn({
    type: resolveDbType('datetime'),
    default: () => 'CURRENT_TIMESTAMP',
  })
  public updatedAt: Date;
}
