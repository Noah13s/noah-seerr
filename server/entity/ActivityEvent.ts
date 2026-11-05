import { DbAwareColumn } from '@server/utils/DbColumnHelper';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class ActivityEvent {
  @PrimaryGeneratedColumn() public id: number;
  @Index() @Column({ type: 'integer' }) public userId: number;
  @Column({ type: 'varchar' }) public userName: string;
  @Index() @Column({ type: 'varchar' }) public category: string;
  @Column({ type: 'varchar' }) public action: string;
  @Column({ type: 'varchar' }) public device: string;
  @Column({ type: 'varchar', default: '' }) public title: string;
  @Column({ type: 'text', default: '{}' }) public details: string;
  @Index()
  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;
}
