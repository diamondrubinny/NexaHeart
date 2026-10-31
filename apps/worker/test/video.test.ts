// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { InvalidVideoError, sniffVideo, transcodeVideo, videoArgs } from '../src/video.js';

const dir = mkdtempSync(join(tmpdir(), 'video-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A 40 s, 1280×720 phone-like clip with sound, GPS and device metadata. */
function clip(name: string, format: 'mp4' | 'webm'): Buffer {
  const out = join(dir, name);
  execFileSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=1280x720:rate=30:duration=40',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=40',
    '-metadata',
    'location=+32.0853+034.7818/',
    '-metadata',
    'com.apple.quicktime.make=TestPhone',
    '-metadata',
    'creation_time=2026-10-31T12:00:00Z',
    ...(format === 'mp4'
      ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-f', 'mp4']
      : ['-c:v', 'libvpx', '-deadline', 'realtime', '-c:a', 'libopus', '-f', 'webm']),
    '-y',
    out,
  ]);
  return readFileSync(out);
}

function probe(buffer: Buffer): {
  format: { duration: string; tags?: Record<string, string> };
  streams: { codec_type: string; width?: number; height?: number; tags?: Record<string, string> }[];
} {
  const file = join(dir, `probe-${Math.random()}.mp4`);
  writeFileSync(file, buffer);
  return JSON.parse(
    execFileSync('ffprobe', [
      '-v',
      'error',
      '-show_format',
      '-show_streams',
      '-of',
      'json',
      file,
    ]).toString(),
  );
}

describe('video prompts (phase 76h)', () => {
  it('forces the sniffed demuxer and drops metadata, chapters and extra streams', () => {
    const args = videoArgs('/in', '/out.mp4', 'mov');
    expect(args.slice(args.indexOf('-f'), args.indexOf('-f') + 2)).toEqual(['-f', 'mov']);
    expect(args).toContain('-map_chapters');
    expect(args.join(' ')).toContain('-map_metadata -1');
    expect(args.join(' ')).toContain('-protocol_whitelist file');
    expect(args).toEqual(expect.arrayContaining(['-sn', '-dn', '-t', '30']));
  });

  it('refuses anything that is not MP4/MOV or WebM', async () => {
    expect(await sniffVideo(Buffer.from('<?xml version="1.0"?><svg/>'))).toBeUndefined();
    await expect(transcodeVideo(Buffer.from('not a video at all'))).rejects.toBeInstanceOf(
      InvalidVideoError,
    );
  });

  for (const format of ['mp4', 'webm'] as const) {
    it(`re-encodes a ${format} clip: ≤30 s, ≤720 px, no location or device metadata`, async () => {
      const original = clip(`in.${format}`, format);
      expect(JSON.stringify(probe(original).format.tags ?? {})).toMatch(
        /location|32\.0853|TestPhone/i,
      );
      const result = await transcodeVideo(original);
      expect(result.durationMs).toBeGreaterThan(29_000);
      expect(result.durationMs).toBeLessThanOrEqual(30_500);
      const info = probe(result.data);
      const video = info.streams.find((s) => s.codec_type === 'video')!;
      expect(Math.max(video.width!, video.height!)).toBeLessThanOrEqual(720);
      // Tags only ("chroma_location" is a pixel format field, not a place).
      const tags = JSON.stringify([
        info.format.tags ?? {},
        ...info.streams.map((s) => s.tags ?? {}),
      ]);
      expect(tags).not.toMatch(/location|32\.0853|TestPhone|2026-10-31|Lav[fc]\d/i);
      // The poster is a real JPEG.
      expect(result.poster.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    }, 120_000);
  }
});
