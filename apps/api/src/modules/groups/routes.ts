// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  groupDetailSchema,
  groupPostInputSchema,
  groupPostSchema,
  groupPostsSchema,
  groupSchema,
} from '@nexaheart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Auth } from '../../auth/auth.js';
import { currentUser, requireUser } from '../../auth/session.js';
import { perUserLimit } from '../../plugins/security.js';
import type { GroupService } from './service.js';

const params = z.object({ id: z.uuid() });

/** Interest groups for members (phase 76e). Admins manage them under /v1/admin/groups. */
export const groupRoutes: FastifyPluginAsyncZod<{ auth: Auth; groups: GroupService }> = async (
  app,
  { auth, groups },
) => {
  app.addHook('preHandler', requireUser(auth));

  app.get(
    '/v1/groups',
    { schema: { response: { 200: z.object({ groups: z.array(groupSchema) }) } } },
    async (request) => ({ groups: await groups.list(currentUser(request).id) }),
  );
  app.get(
    '/v1/groups/:id',
    { schema: { params, response: { 200: groupDetailSchema } } },
    async (request) => groups.detail(request.params.id, currentUser(request).id),
  );
  const membership = perUserLimit(60, 60 * 60_000);
  app.post(
    '/v1/groups/:id/join',
    { config: membership, schema: { params, response: { 200: groupDetailSchema } } },
    async (request) => groups.join(request.params.id, currentUser(request).id),
  );
  app.post(
    '/v1/groups/:id/leave',
    { config: membership, schema: { params, response: { 204: z.null() } } },
    async (request, reply) => {
      await groups.leave(request.params.id, currentUser(request).id);
      return reply.status(204).send(null);
    },
  );
  app.get(
    '/v1/groups/:id/posts',
    {
      schema: {
        params,
        querystring: z.object({ before: z.string().max(40).optional() }),
        response: { 200: groupPostsSchema },
      },
    },
    async (request) =>
      groups.posts(request.params.id, currentUser(request).id, request.query.before),
  );
  app.post(
    '/v1/groups/:id/posts',
    {
      config: perUserLimit(30, 60 * 60_000),
      bodyLimit: 4096,
      schema: { params, body: groupPostInputSchema, response: { 201: groupPostSchema } },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(await groups.post(request.params.id, currentUser(request).id, request.body.body)),
  );
  app.delete(
    '/v1/group-posts/:id',
    { config: membership, schema: { params, response: { 204: z.null() } } },
    async (request, reply) => {
      await groups.deletePost(request.params.id, currentUser(request).id);
      return reply.status(204).send(null);
    },
  );
};
