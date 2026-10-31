// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { readFileSync } from 'node:fs';
import { schema } from '@nexaheart/db';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

/**
 * Phase 78: the operator's data map (docs/PRIVACY.md) lists every database table. A new table can't
 * ship without saying what it holds, why and for how long.
 */
const privacy = readFileSync(new URL('../../../docs/PRIVACY.md', import.meta.url), 'utf8');
const appendix = privacy.slice(privacy.indexOf('## Appendix: every database table'));
const listed = new Set([...appendix.matchAll(/^\| `([a-z_0-9]+)` +\|/gm)].map((m) => m[1]!));
const tables = (Object.values(schema) as unknown[])
  .filter((value): value is PgTable => value instanceof PgTable)
  .map((table) => getTableConfig(table).name);

describe('data map (phase 78)', () => {
  it('has an appendix of tables', () => {
    expect(appendix.length).toBeGreaterThan(100);
    expect(tables.length).toBeGreaterThan(50);
  });

  it('lists every table in the database', () => {
    const missing = tables.filter((name) => !listed.has(name));
    expect(missing, 'Add these tables to the appendix of docs/PRIVACY.md').toEqual([]);
  });

  it('lists no table that no longer exists', () => {
    const known = new Set(tables);
    expect([...listed].filter((name) => !known.has(name))).toEqual([]);
  });
});
