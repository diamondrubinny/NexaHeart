// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_VIDEO_SECONDS, VIDEO_MAX_SIDE } from '@nexaheart/shared';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';

/**
 * Phase 76h: video prompts. The upload is identified by its magic bytes, decoded with only the
 * demuxer for that container, and re-encoded from scratch: H.264 + AAC in MP4, at most 720 px and
 * 30 fps, cut at 30 s, with every metadata block and chapter dropped (GPS, device, dates). The
 * original never leaves quarantine.
 */
const containers: Record<string, 'mov' | 'matroska'> = {
  'video/mp4': 'mov',
  'video/quicktime': 'mov',
  'video/x-m4v': 'mov',
  'video/webm': 'matroska',
  'video/x-matroska': 'matroska',
};

export type VideoContainer = (typeof containers)[string];

export class InvalidVideoError extends Error {}

export async function sniffVideo(buffer: Buffer): Promise<VideoContainer | undefined> {
  const detected = await fileTypeFromBuffer(buffer);
  return detected ? containers[detected.mime.split(';')[0]!.trim()] : undefined;
}

/** The output is capped too (a decoder bomb can't fill the disk). */
export const VIDEO_OUTPUT_MAX_BYTES = 30 * 1024 * 1024;

export function videoArgs(
  input: string,
  output: string,
  container: VideoContainer,
  maxSeconds = MAX_VIDEO_SECONDS,
): string[] {
  const side = VIDEO_MAX_SIDE;
  return [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    // Only the demuxer for the sniffed container: no format guessing, no playlists or URLs.
    '-f',
    container,
    '-protocol_whitelist',
    'file',
    '-i',
    input,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-sn',
    '-dn',
    '-map_metadata',
    '-1',
    '-map_metadata:s:v',
    '-1',
    '-map_metadata:s:a',
    '-1',
    '-map_chapters',
    '-1',
    // Fit inside side×side, keep the aspect ratio, even dimensions for H.264.
    '-vf',
    `scale='min(${side},iw)':'min(${side},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '28',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '64k',
    '-ac',
    '1',
    '-t',
    String(maxSeconds),
    '-fs',
    String(VIDEO_OUTPUT_MAX_BYTES),
    '-movflags',
    '+faststart',
    // No versioned "encoder: Lavf60…" tags: they would tell anyone the server's ffmpeg version.
    '-fflags',
    '+bitexact',
    '-flags:v',
    '+bitexact',
    '-flags:a',
    '+bitexact',
    '-f',
    'mp4',
    '-y',
    output,
  ];
}

function run(binary: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // execFile: no shell, arguments are passed verbatim.
    execFile(binary, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    );
  });
}

export interface TranscodedVideo {
  data: Buffer;
  /** A JPEG frame (re-encoded by sharp), shown before playing. */
  poster: Buffer;
  durationMs: number;
}

export async function transcodeVideo(
  buffer: Buffer,
  options: {
    ffmpeg?: string | undefined;
    ffprobe?: string | undefined;
    timeoutMs?: number;
    maxSeconds?: number;
  } = {},
): Promise<TranscodedVideo> {
  const container = await sniffVideo(buffer);
  if (!container) throw new InvalidVideoError('unsupported_format');
  const dir = await mkdtemp(join(tmpdir(), 'nexaheart-video-'));
  const input = join(dir, 'in');
  const output = join(dir, 'out.mp4');
  const frame = join(dir, 'poster.jpg');
  try {
    await writeFile(input, buffer, { mode: 0o600 });
    const ffmpeg = options.ffmpeg ?? 'ffmpeg';
    try {
      await run(
        ffmpeg,
        videoArgs(input, output, container, options.maxSeconds),
        options.timeoutMs ?? 120_000,
      );
    } catch {
      throw new InvalidVideoError('undecodable');
    }
    if (((await stat(output).catch(() => null))?.size ?? 0) === 0) {
      throw new InvalidVideoError('undecodable');
    }
    const probe = await run(
      options.ffprobe ?? 'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', output],
      15_000,
    );
    const durationMs = Math.round(Number.parseFloat(probe.trim()) * 1000);
    if (!Number.isFinite(durationMs) || durationMs <= 0) throw new InvalidVideoError('undecodable');
    // The poster comes from our own re-encoded file, a second in (or the first frame).
    await run(
      ffmpeg,
      [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'mp4',
        '-i',
        output,
        '-ss',
        durationMs > 1500 ? '1' : '0',
        '-frames:v',
        '1',
        '-y',
        frame,
      ],
      20_000,
    );
    const poster = await sharp(await readFile(frame))
      .rotate()
      .jpeg({ quality: 82 })
      .toBuffer();
    return { data: await readFile(output), poster, durationMs };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
