// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
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

/** Larger frames are refused before decoding (a 40 MB file can describe gigantic frames). */
export const VIDEO_INPUT_MAX_SIDE = 4096;
/** Decoders ffmpeg may use on an upload: what phones and browsers record, nothing exotic. */
export const VIDEO_DECODERS = [
  'h264',
  'hevc',
  'vp8',
  'vp9',
  'av1',
  'libdav1d',
  'mpeg4',
  'aac',
  'opus',
  'libopus',
  'vorbis',
  'mp3',
  'pcm_s16le',
  'pcm_s16be',
];
const VIDEO_CODECS = new Set(['h264', 'hevc', 'vp8', 'vp9', 'av1', 'mpeg4']);
/** Address-space cap for each ffmpeg run (with prlimit, when the system has it). */
export const VIDEO_MEMORY_BYTES = 2 * 1024 * 1024 * 1024;

/** Input options shared by the probe and the decode: one demuxer, local file only. */
function inputArgs(input: string, container: VideoContainer): string[] {
  return ['-f', container, '-protocol_whitelist', 'file', '-i', input];
}

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
    // Phase 77e: only common decoders, bounded frame size and threads (memory).
    '-threads',
    '2',
    '-codec_whitelist',
    VIDEO_DECODERS.join(','),
    '-max_pixels',
    String(VIDEO_INPUT_MAX_SIDE * VIDEO_INPUT_MAX_SIDE),
    // Only the demuxer for the sniffed container: no format guessing, no playlists or URLs.
    ...inputArgs(input, container),
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
    '-threads',
    '2',
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

const PRLIMIT = '/usr/bin/prlimit';
let hasPrlimit: boolean | undefined;

function run(binary: string, args: string[], timeoutMs: number): Promise<string> {
  hasPrlimit ??= existsSync(PRLIMIT);
  // Phase 77e: a memory cap, so one upload can't take the worker (and its other jobs) down.
  const [command, argv] = hasPrlimit
    ? [PRLIMIT, [`--as=${VIDEO_MEMORY_BYTES}`, '--', binary, ...args]]
    : [binary, args];
  return new Promise((resolve, reject) => {
    // execFile: no shell, arguments are passed verbatim.
    execFile(command, argv, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      // prlimit reports a missing program as exit code 127: the same as ENOENT without it.
      if (error && hasPrlimit && (error as { code?: unknown }).code === 127) {
        (error as { code?: unknown }).code = 'ENOENT';
      }
      return error ? reject(error) : resolve(stdout);
    });
  });
}

/** The first video stream's codec and size, read with the same forced demuxer. */
async function probeInput(ffprobe: string, input: string, container: VideoContainer) {
  const out = await run(
    ffprobe,
    [
      '-v',
      'error',
      ...inputArgs(input, container),
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=codec_name,width,height',
      '-of',
      'json',
    ],
    15_000,
  );
  const stream = (
    JSON.parse(out) as { streams?: { codec_name?: string; width?: number; height?: number }[] }
  ).streams?.[0];
  return stream;
}

/**
 * Phase 76h: a WebM (VP8/Opus) rendition for browsers without H.264 (some Linux builds), made from
 * our own clean MP4, never from the upload.
 */
export function webmArgs(mp4: string, output: string): string[] {
  return [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'mp4',
    '-protocol_whitelist',
    'file',
    '-i',
    mp4,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-map_metadata',
    '-1',
    '-c:v',
    'libvpx',
    '-deadline',
    'realtime',
    '-cpu-used',
    '8',
    '-b:v',
    '900k',
    '-crf',
    '30',
    '-threads',
    '2',
    '-c:a',
    'libopus',
    '-b:a',
    '48k',
    '-ac',
    '1',
    '-fs',
    String(VIDEO_OUTPUT_MAX_BYTES),
    '-fflags',
    '+bitexact',
    '-flags:v',
    '+bitexact',
    '-flags:a',
    '+bitexact',
    '-f',
    'webm',
    '-y',
    output,
  ];
}

export interface TranscodedVideo {
  data: Buffer;
  /** The same video as WebM (VP8/Opus). */
  webm: Buffer;
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
  const webm = join(dir, 'out.webm');
  try {
    await writeFile(input, buffer, { mode: 0o600 });
    const ffmpeg = options.ffmpeg ?? 'ffmpeg';
    const ffprobe = options.ffprobe ?? 'ffprobe';
    // Phase 77e: check the codec and frame size before anything decodes a frame.
    const stream = await probeInput(ffprobe, input, container).catch((error: unknown) => {
      // A missing binary is the server's problem (retried), not the file's.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error;
      return undefined;
    });
    if (!stream?.codec_name || !VIDEO_CODECS.has(stream.codec_name)) {
      throw new InvalidVideoError(stream ? 'unsupported_format' : 'undecodable');
    }
    if (
      !stream.width ||
      !stream.height ||
      stream.width > VIDEO_INPUT_MAX_SIDE ||
      stream.height > VIDEO_INPUT_MAX_SIDE
    ) {
      throw new InvalidVideoError('too_large');
    }
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
    // From here on every failure is about this file, not the server: refused, not retried.
    let durationMs: number;
    let poster: Buffer;
    try {
      const probe = await run(
        ffprobe,
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', output],
        15_000,
      );
      durationMs = Math.round(Number.parseFloat(probe.trim()) * 1000);
      if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error('no duration');
      // The poster comes from our own re-encoded file, a second in; else the first frame (a clip
      // whose video stream is shorter than its audio has no frame at 1 s).
      for (const at of durationMs > 1500 ? ['1', '0'] : ['0']) {
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
            at,
            '-frames:v',
            '1',
            '-y',
            frame,
          ],
          20_000,
        );
        if (((await stat(frame).catch(() => null))?.size ?? 0) > 0) break;
      }
      poster = await sharp(await readFile(frame))
        .rotate()
        .jpeg({ quality: 82 })
        .toBuffer();
      await run(ffmpeg, webmArgs(output, webm), options.timeoutMs ?? 120_000);
      if (((await stat(webm).catch(() => null))?.size ?? 0) === 0) throw new Error('no webm');
    } catch {
      throw new InvalidVideoError('undecodable');
    }
    return { data: await readFile(output), webm: await readFile(webm), poster, durationMs };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
