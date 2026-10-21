import Image from 'next/image';

export const PROFILE_AVATARS = [
  { id: 'preset-01', name: 'Fox', src: '/profile-avatars/preset-01.svg' },
  { id: 'preset-02', name: 'Panda', src: '/profile-avatars/preset-02.svg' },
  { id: 'preset-03', name: 'Cat', src: '/profile-avatars/preset-03.svg' },
  { id: 'preset-04', name: 'Robot', src: '/profile-avatars/preset-04.svg' },
  { id: 'preset-05', name: 'Astronaut', src: '/profile-avatars/preset-05.svg' },
  { id: 'preset-06', name: 'Alien', src: '/profile-avatars/preset-06.svg' },
  { id: 'preset-07', name: 'Dragon', src: '/profile-avatars/preset-07.svg' },
  { id: 'preset-08', name: 'Owl', src: '/profile-avatars/preset-08.svg' },
  { id: 'preset-09', name: 'Mountain', src: '/profile-avatars/preset-09.svg' },
  { id: 'preset-10', name: 'Ocean', src: '/profile-avatars/preset-10.svg' },
  { id: 'preset-11', name: 'Forest', src: '/profile-avatars/preset-11.svg' },
  { id: 'preset-12', name: 'Sunset', src: '/profile-avatars/preset-12.svg' },
  { id: 'preset-13', name: 'Arcade', src: '/profile-avatars/preset-13.svg' },
  { id: 'preset-14', name: 'Moon', src: '/profile-avatars/preset-14.svg' },
  { id: 'preset-15', name: 'Lightning', src: '/profile-avatars/preset-15.svg' },
  { id: 'preset-16', name: 'Crystal', src: '/profile-avatars/preset-16.svg' },
] as const;

interface AvatarPickerProps {
  value?: string;
  onChange: (avatar: string) => void;
}

const AvatarPicker = ({ value, onChange }: AvatarPickerProps) => (
  <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 lg:grid-cols-8">
    {PROFILE_AVATARS.map((avatar) => {
      const selected = value === avatar.src;

      return (
        <button
          key={avatar.id}
          type="button"
          aria-label={avatar.name}
          aria-pressed={selected}
          onClick={() => onChange(avatar.src)}
          className={`relative aspect-square overflow-hidden rounded-xl border-2 bg-gray-800 transition duration-150 hover:scale-105 hover:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 focus:ring-offset-gray-900 ${
            selected
              ? 'border-indigo-400 ring-2 ring-indigo-400 ring-offset-2 ring-offset-gray-900'
              : 'border-transparent'
          }`}
        >
          <Image
            src={avatar.src}
            alt={avatar.name}
            fill
            sizes="(max-width: 640px) 22vw, 96px"
            className="object-cover"
            unoptimized
          />
          {selected && (
            <span className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500 text-xs font-bold text-white shadow">
              ✓
            </span>
          )}
        </button>
      );
    })}
  </div>
);

export default AvatarPicker;
