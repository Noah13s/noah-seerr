import type { PlayButtonLink } from '@app/components/Common/PlayButton';
import {
  CastIcon,
  useCasting,
  type CastHandoff,
} from '@app/context/CastingContext';

const CastButton = ({
  link,
  handoff,
  resolveLink,
}: {
  link: PlayButtonLink;
  handoff?: CastHandoff;
  resolveLink?: () => PlayButtonLink;
}) => {
  const { open, label } = useCasting();
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="media-action inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-gray-600 px-3 py-2 text-sm text-white hover:border-gray-200 focus:ring-2 focus:ring-indigo-400"
      onClick={() => void open(resolveLink?.() ?? link, handoff)}
    >
      <CastIcon className="h-5 w-5 shrink-0" />
      <span>{label}</span>
    </button>
  );
};
export default CastButton;
