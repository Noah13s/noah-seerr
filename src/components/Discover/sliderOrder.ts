import { isAnimeDiscoverSlider } from '@server/constants/discover';
import type DiscoverSlider from '@server/entity/DiscoverSlider';

type Slider = Partial<DiscoverSlider>;

export const visibleDiscoverSliders = (
  sliders: Slider[],
  showAnime?: boolean
) =>
  sliders.filter(
    (slider) => showAnime !== false || !isAnimeDiscoverSlider(slider)
  );

export const reorderDiscoverSliders = (
  sliders: Slider[],
  visible: Slider[],
  itemId: number,
  targetId: number,
  position: 'Above' | 'Below',
  arrows: boolean
): Slider[] => {
  const from = visible.findIndex((slider) => slider.id === itemId);
  const target = visible.findIndex((slider) => slider.id === targetId);
  if (from < 0 || target < 0) return sliders;
  const ordered = visible.slice();
  const [item] = ordered.splice(from, 1);
  const to = arrows
    ? from + (position === 'Above' ? -1 : 1)
    : target + (position === 'Below' ? 1 : 0) - (from < target ? 1 : 0);
  ordered.splice(Math.max(0, Math.min(to, ordered.length)), 0, item);
  // Hidden anime retain their saved slots and visibility settings.
  const ids = new Set(visible.map((slider) => slider.id));
  let index = 0;
  return sliders.map((slider) =>
    ids.has(slider.id) ? ordered[index++] : slider
  );
};
