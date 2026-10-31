// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  GROUP_ABOUT_MAX,
  GROUP_NAME_MAX,
  GROUP_SIZE_DEFAULT,
  GROUP_SIZE_MAX,
  type AdminGroupPost,
  type Group,
} from '@nexaheart/shared';
import { useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAsync } from '../hooks';
import { format, useLocale } from '../i18n';
import { Badge, ErrorBox, Loading } from '../components/ui';

/**
 * Interest groups (phase 76e). Every staff member sees the groups and their posts (to moderate);
 * only admins open, edit or close a group. Removing a post is logged.
 */
export function Groups({ isAdmin }: { isAdmin: boolean }) {
  const { t, locale } = useLocale();
  const list = useAsync(() => api.groups(), []);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('💬');
  const [about, setAbout] = useState('');
  const [capacity, setCapacity] = useState(String(GROUP_SIZE_DEFAULT));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  const [notice, setNotice] = useState<string>();
  const [open, setOpen] = useState<{ group: Group; posts: AdminGroupPost[] }>();
  const statusRef = useRef<HTMLParagraphElement>(null);

  const announce = (text: string) => {
    setNotice(text);
    statusRef.current?.focus();
  };

  async function create(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const group = await api.createGroup({
        name: name.trim(),
        emoji: emoji.trim() || '💬',
        about: about.trim(),
        capacity: Number(capacity) || GROUP_SIZE_DEFAULT,
      });
      announce(format(t.groups.added, { name: group.name }));
      setName('');
      setAbout('');
      list.reload();
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(g: Group) {
    setError(undefined);
    try {
      await api.updateGroup(g.id, { archived: !g.archived });
      announce(format(g.archived ? t.groups.reopened : t.groups.closedNotice, { name: g.name }));
      list.reload();
    } catch (err) {
      setError(err as Error);
    }
  }

  async function decide(g: Group, approve: boolean) {
    setError(undefined);
    try {
      await api.decideGroup(g.id, approve);
      announce(format(approve ? t.groups.approved : t.groups.declined, { name: g.name }));
      list.reload();
    } catch (err) {
      setError(err as Error);
    }
  }

  async function showPosts(g: Group) {
    setError(undefined);
    try {
      setOpen({ group: g, posts: (await api.groupPosts(g.id)).posts });
    } catch (err) {
      setError(err as Error);
    }
  }

  async function remove(post: AdminGroupPost) {
    if (!open) return;
    setError(undefined);
    try {
      await api.removeGroupPost(post.id);
      setOpen({ ...open, posts: open.posts.filter((p) => p.id !== post.id) });
      announce(t.groups.removed);
    } catch (err) {
      setError(err as Error);
    }
  }

  const groups = list.data?.groups ?? [];
  return (
    <section aria-labelledby="groups-title">
      <h1 id="groups-title">{t.groups.title}</h1>
      <p className="help">{t.groups.intro}</p>
      <p
        ref={statusRef}
        tabIndex={-1}
        role="status"
        className={notice ? 'alert alert-ok' : 'visually-hidden'}
      >
        {notice ?? ''}
      </p>
      {error ? <ErrorBox error={error} /> : null}

      <div className="grid venues-grid">
        <div>
          {list.loading && !list.data ? <Loading /> : null}
          {list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : null}
          {list.data && groups.length === 0 ? <p className="empty">{t.groups.empty}</p> : null}
          {groups.length > 0 ? (
            <div className="table-wrap" tabIndex={0} role="region" aria-labelledby="groups-title">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t.groups.name}</th>
                    <th scope="col">{t.groups.members}</th>
                    <th scope="col">{t.groups.status}</th>
                    <th scope="col">
                      <span className="visually-hidden">{t.groups.actions}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.id}>
                      <th scope="row">
                        {g.emoji} {g.name}
                        {g.about ? (
                          <span className="muted block cell-detail">{g.about}</span>
                        ) : null}
                        {g.host ? (
                          <span className="muted block cell-detail">
                            {format(t.groups.hostedBy, { name: g.host.displayName })}
                          </span>
                        ) : null}
                      </th>
                      <td>
                        {g.members} / {g.capacity}
                      </td>
                      <td>
                        {g.status === 'pending' ? (
                          <Badge tone="normal">{t.groups.pending}</Badge>
                        ) : (
                          <Badge tone={g.archived ? 'muted' : 'ok'}>
                            {g.archived ? t.groups.closed : t.groups.openStatus}
                          </Badge>
                        )}
                      </td>
                      <td className="actions">
                        <button
                          type="button"
                          className="button small"
                          onClick={() => void showPosts(g)}
                        >
                          {t.groups.posts}
                          <span className="visually-hidden"> {g.name}</span>
                        </button>
                        {isAdmin && g.status === 'pending' ? (
                          <>
                            <button
                              type="button"
                              className="button small primary"
                              onClick={() => void decide(g, true)}
                            >
                              {t.groups.approve}
                              <span className="visually-hidden"> {g.name}</span>
                            </button>
                            <button
                              type="button"
                              className="button small"
                              onClick={() => void decide(g, false)}
                            >
                              {t.groups.decline}
                              <span className="visually-hidden"> {g.name}</span>
                            </button>
                          </>
                        ) : null}
                        {isAdmin && g.status !== 'pending' ? (
                          <button
                            type="button"
                            className="button small"
                            onClick={() => void toggle(g)}
                          >
                            {g.archived ? t.groups.reopen : t.groups.close}
                            <span className="visually-hidden"> {g.name}</span>
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {open ? (
            <div className="card" role="region" aria-labelledby="group-posts-title">
              <h2 id="group-posts-title">
                {format(t.groups.postsOf, { name: `${open.group.emoji} ${open.group.name}` })}
              </h2>
              {open.posts.length === 0 ? <p className="empty">{t.groups.noPosts}</p> : null}
              <ul className="plain-list">
                {open.posts.map((p) => (
                  <li key={p.id}>
                    <p>
                      <strong>{p.authorName}</strong>{' '}
                      <span className="muted">{new Date(p.createdAt).toLocaleString(locale)}</span>
                    </p>
                    <p>{p.body}</p>
                    <button type="button" className="button small" onClick={() => void remove(p)}>
                      {t.groups.remove}
                      <span className="visually-hidden"> {p.authorName}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        {isAdmin ? (
          <form className="card" onSubmit={create} aria-labelledby="group-form-title">
            <h2 id="group-form-title">{t.groups.addTitle}</h2>
            <label htmlFor="group-name">{t.groups.name}</label>
            <input
              id="group-name"
              value={name}
              required
              minLength={2}
              maxLength={GROUP_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
            />
            <label htmlFor="group-emoji">{t.groups.emoji}</label>
            <input
              id="group-emoji"
              value={emoji}
              maxLength={8}
              onChange={(e) => setEmoji(e.target.value)}
            />
            <label htmlFor="group-about">{t.groups.about}</label>
            <textarea
              id="group-about"
              rows={3}
              maxLength={GROUP_ABOUT_MAX}
              value={about}
              onChange={(e) => setAbout(e.target.value)}
            />
            <label htmlFor="group-capacity">{t.groups.capacity}</label>
            <input
              id="group-capacity"
              type="number"
              min={2}
              max={GROUP_SIZE_MAX}
              value={capacity}
              aria-describedby="group-capacity-help"
              onChange={(e) => setCapacity(e.target.value)}
            />
            <p id="group-capacity-help" className="help">
              {t.groups.capacityHelp}
            </p>
            <p className="help">{t.groups.privacy}</p>
            <button type="submit" className="button primary" disabled={busy}>
              {t.groups.add}
            </button>
          </form>
        ) : null}
      </div>
    </section>
  );
}
