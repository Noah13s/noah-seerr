import type { DiscoverSliderType } from '@server/constants/discover';
import { defaultSliders } from '@server/constants/discover';
import { getRepository } from '@server/datasource';
import logger from '@server/logger';
import { DbAwareColumn, resolveDbType } from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity()
class DiscoverSlider {
  public static async bootstrapSliders(): Promise<void> {
    const sliderRepository = getRepository(DiscoverSlider);
    await sliderRepository.manager.transaction(async (manager) => {
      const repository = manager.getRepository(DiscoverSlider);
      const existing = await repository.find({ order: { order: 'ASC', id: 'ASC' } });
      const missing = defaultSliders.filter(
        (slider) => !existing.some((saved) => saved.type === slider.type)
      );
      if (!missing.length) return;

      // Newly configurable sections used to appear ahead of every saved slider.
      // Preserve that layout once, keeping every existing ID, toggle and order.
      const leading = missing.filter((slider) => Number(slider.type) >= 22);
      const trailing = missing.filter((slider) => Number(slider.type) < 22);
      const ordered = existing.length
        ? [...leading.map((slider) => new DiscoverSlider(slider)), ...existing,
            ...trailing.map((slider) => new DiscoverSlider(slider))]
        : missing.map((slider) => new DiscoverSlider(slider));
      await repository.save(ordered.map((slider, order) => Object.assign(slider, { order })));
      logger.info('Created missing built-in discovery sliders', {
        label: 'Discover Slider', count: missing.length,
      });
    });
  }

  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'int' })
  public type: DiscoverSliderType;

  @Column({ type: 'int' })
  public order: number;

  @Column({ default: false })
  public isBuiltIn: boolean;

  @Column({ default: true })
  public enabled: boolean;

  @Column({ nullable: true })
  // Title is not required for built in sliders because we will
  // use translations for them.
  public title?: string;

  @Column({ nullable: true })
  public data?: string;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  @UpdateDateColumn({
    type: resolveDbType('datetime'),
    default: () => 'CURRENT_TIMESTAMP',
  })
  public updatedAt: Date;

  constructor(init?: Partial<DiscoverSlider>) {
    Object.assign(this, init);
  }
}

export default DiscoverSlider;
