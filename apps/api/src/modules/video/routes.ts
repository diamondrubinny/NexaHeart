// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import multipart from '@fastify/multipart';
import { ErrorCode, MAX_VIDEO_BYTES, myVideoSchema, promptKeySchema } from '@nexaheart/shared';
import type { StoredObject } from '@nexaheart/storage';
import type { FastifyReply } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Auth } from '../../auth/auth.js';
import { currentUser, requireUser } from '../../auth/session.js';
import { HttpError } from '../../plugins/error-handler.js';
import { perUserLimit } from '../../plugins/security.js';
import { parseRange, type VideoPart, type VideoService } from './service.js';

/**
 * Sends a video or poster: private (never kept by shared caches), never sniffed, with byte ranges
 * for the video (iOS players need them).
 */
export function sendVideoPart(
  reply: FastifyReply,
  object: StoredObject,
  part: VideoPart,
  cache: 'private' | 'no-store',
) {
  reply
    .type(part === 'video' ? 'video/mp4' : part === 'webm' ? 'video/webm' : 'image/jpeg')
    .header('x-content-type-options', 'nosniff')
    .header('content-disposition', 'inline')
    .header('cache-control', cache === 'private' ? 'private, max-age=300' : 'no-store');
  if (part !== 'poster') reply.header('accept-ranges', 'bytes');
  if (object.contentLength !== undefined) reply.header('content-length', object.contentLength);
  if (object.contentRange) reply.status(206).header('content-range', object.contentRange);
  return reply.send(object.body);
}

const idParams = z.object({ id: z.uuid() });
/** `?format=webm`: the WebM rendition, for browsers without H.264. */
export const videoFormatQuery = z.object({ format: z.enum(['mp4', 'webm']).default('mp4') });
export const videoPartOf = (part: 'video' | 'poster', format: 'mp4' | 'webm'): VideoPart =>
  part === 'video' && format === 'webm' ? 'webm' : part;

export const videoRoutes: FastifyPluginAsyncZod<{ auth: Auth; videos: VideoService }> = async (
  app,
  { auth, videos },
) => {
  await app.register(multipart, {
    limits: { fileSize: MAX_VIDEO_BYTES, files: 1, fields: 0, parts: 1 },
  });
  app.addHook('preHandler', requireUser(auth));

  app.get('/v1/me/video', { schema: { response: { 200: myVideoSchema } } }, async (request) =>
    videos.mine(currentUser(request).id),
  );

  app.post(
    '/v1/me/video',
    {
      config: perUserLimit(10, 24 * 60 * 60_000),
      bodyLimit: MAX_VIDEO_BYTES + 64 * 1024,
      schema: {
        querystring: z.object({ promptKey: promptKeySchema }).strict(),
        response: { 200: myVideoSchema },
      },
    },
    async (request) => {
      const file = await request.file();
      if (!file) throw new HttpError(400, ErrorCode.BadRequest, 'Attach one video file.');
      const buffer = await file.toBuffer();
      if (file.file.truncated || buffer.length > MAX_VIDEO_BYTES) {
        throw new HttpError(413, ErrorCode.PayloadTooLarge, 'The video is too large.');
      }
      return videos.upload(currentUser(request).id, request.query.promptKey, buffer);
    },
  );

  app.delete('/v1/me/video', { schema: { response: { 200: myVideoSchema } } }, async (request) => {
    await videos.remove(currentUser(request).id);
    return { video: null };
  });

  for (const part of ['video', 'poster'] as const) {
    app.get(
      part === 'video' ? '/v1/videos/:id' : '/v1/videos/:id/poster',
      {
        config: perUserLimit(600, 60 * 60_000),
        schema: { params: idParams, querystring: videoFormatQuery },
      },
      async (request, reply) => {
        const which = videoPartOf(part, request.query.format);
        const object = await videos.open(
          currentUser(request).id,
          request.params.id,
          which,
          parseRange(request.headers.range),
        );
        // Not kept even by the browser: a rejection, block or blur takes effect at once.
        return sendVideoPart(reply, object, which, 'no-store');
      },
    );
  }
};
