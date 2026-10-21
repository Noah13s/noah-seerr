import { User } from '@server/entity/User';
import type { ViewingProgress } from '@server/interfaces/api/watchHistoryInterfaces';
import { DbAwareColumn, resolveDbType } from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum WatchHistoryStatus {
  PLANNED = 'planned',
  WATCHING = 'watching',
  COMPLETED = 'completed',
  DROPPED = 'dropped',
}

const seasonProgressTransformer = {
  from: (value: string | null): Record<string, number> => {
    try {
      return value ? JSON.parse(value) : {};
    } catch {
      return {};
    }
  },
  to: (value: Record<string, number> | null): string | null =>
    value && Object.keys(value).length ? JSON.stringify(value) : null,
};

const episodeOverridesTransformer = {
  from: (value: string | null): Record<string, boolean> => {
    try {
      return value ? JSON.parse(value) : {};
    } catch {
      return {};
    }
  },
  to: (value: Record<string, boolean> | null): string | null =>
    value && Object.keys(value).length ? JSON.stringify(value) : null,
};

@Entity()
export class WatchHistory {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'varchar' })
  public mediaType: 'movie' | 'tv';

  @Column({ type: 'integer', nullable: true })
  @Index()
  public tmdbId?: number | null;

  @Column({ type: 'varchar' })
  @Index()
  public title: string;

  @Column({ type: 'integer', nullable: true })
  public releaseYear?: number | null;

  @Column({ type: 'varchar', default: WatchHistoryStatus.WATCHING })
  @Index()
  public status: WatchHistoryStatus;

  @Column({ type: 'integer', default: 0 })
  public watchCount: number;

  @DbAwareColumn({ type: 'datetime', nullable: true })
  public watchedAt?: Date | null;

  @Column({ type: 'integer', nullable: true })
  public watchedEpisodes?: number | null;

  @Column({ type: 'integer', nullable: true })
  public totalEpisodes?: number | null;

  @Column({
    type: 'text',
    nullable: true,
    transformer: seasonProgressTransformer,
  })
  public seasonProgress: Record<string, number>;

  @Column({
    type: 'text',
    nullable: true,
    transformer: episodeOverridesTransformer,
  })
  public episodeOverrides: Record<string, boolean>;

  @Column({
    type: 'text',
    nullable: true,
    transformer: {
      from: (value: string | null): ViewingProgress => {
        try {
          return value ? JSON.parse(value) : {};
        } catch {
          return {};
        }
      },
      to: (value: ViewingProgress | null): string | null =>
        value && Object.keys(value).length ? JSON.stringify(value) : null,
    },
  })
  public viewingProgress: ViewingProgress;

  @Column({ type: 'varchar', nullable: true })
  public categories?: string | null;

  @Column({ type: 'integer', nullable: true })
  public rating?: number | null;

  @Column({ type: 'integer', nullable: true })
  public priority?: number | null;

  @Column({ type: 'varchar', nullable: true })
  public series?: string | null;

  @Column({ type: 'text', nullable: true })
  public notes?: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @Index()
  public user: User;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  @UpdateDateColumn({
    type: resolveDbType('datetime'),
    default: () => 'CURRENT_TIMESTAMP',
  })
  public updatedAt: Date;

  constructor(init?: Partial<WatchHistory>) {
    Object.assign(this, init);
  }
}
