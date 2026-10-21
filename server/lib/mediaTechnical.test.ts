import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  JellyfinLibraryItemExtended,
  JellyfinMediaStream,
} from '@server/api/jellyfin';
import { summarizeMediaTechnical } from './mediaTechnical';

const episode = (
  id: string,
  streams: JellyfinMediaStream[]
): JellyfinLibraryItemExtended => ({
  Id: id,
  Name: id,
  HasSubtitles: true,
  Type: 'Episode',
  LocationType: 'FileSystem',
  MediaType: 'Video',
  ProviderIds: {},
  MediaSources: [
    {
      Id: id,
      Protocol: 'File',
      Path: `/media/${id}`,
      Type: 'Default',
      VideoType: 'VideoFile',
      MediaStreams: streams,
    },
  ],
});

describe('summarizeMediaTechnical', () => {
  it('reports cinematic resolutions and only labeled English/French tracks', () => {
    const result = summarizeMediaTechnical([
      episode('one', [
        {
          Type: 'Video',
          Codec: 'h264',
          Width: 1920,
          Height: 800,
          DisplayTitle: 'H264 SDR',
        },
        { Type: 'Audio', Codec: 'aac', Language: 'und', DisplayTitle: 'AAC' },
        {
          Type: 'Subtitle',
          Codec: 'subrip',
          Language: 'eng',
          DisplayTitle: 'English',
        },
        {
          Type: 'Subtitle',
          Codec: 'subrip',
          Language: 'fra',
          DisplayTitle: 'French',
        },
      ]),
      episode('two', [
        {
          Type: 'Video',
          Codec: 'hevc',
          Width: 3840,
          Height: 1600,
          DisplayTitle: 'HEVC HDR',
        },
        {
          Type: 'Audio',
          Codec: 'eac3',
          Language: 'en-US',
          DisplayTitle: 'English',
        },
        {
          Type: 'Audio',
          Codec: 'aac',
          Language: 'fre',
          DisplayTitle: 'French',
        },
        {
          Type: 'Subtitle',
          Codec: 'subrip',
          Language: 'spa',
          DisplayTitle: 'Spanish',
        },
      ]),
    ]);

    assert.deepEqual(result, {
      fileCount: 2,
      qualities: [
        { resolution: 2160, count: 1 },
        { resolution: 1080, count: 1 },
      ],
      audio: { en: 1, fr: 1, unknown: 1 },
      subtitles: { en: 1, fr: 1 },
    });
  });
});
