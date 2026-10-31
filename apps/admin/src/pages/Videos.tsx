// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { AdminVideo, VideoRejectReason } from '@nexaheart/shared';
import { useRef, useState } from 'react';
import { api } from '../api';
import { useAsync } from '../hooks';
import { format, useLocale } from '../i18n';
import { ErrorBox, Loading, ProtectedImage, ProtectedVideo } from '../components/ui';

/** What a moderator can choose; the pipeline's own reasons (malware, format…) aren't offered. */
const reasons = [
  'nudity',
  'other_people',
  'not_the_member',
  'offensive',
  'too_long',
  'other',
] as const;

function VideoCard({ video, onDone }: { video: AdminVideo; onDone: (text: string) => void }) {
  const { t, locale } = useLocale();
  const [reason, setReason] = useState<(typeof reasons)[number]>('nudity');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  const name = video.displayName || '—';
  const promptLabel =
    t.videos.prompts[video.promptKey as keyof typeof t.videos.prompts] ?? video.promptKey;
  const decide = async (approve: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.decideVideo(
        video.id,
        approve ? { approve } : { approve, reason: reason as VideoRejectReason },
      );
      onDone(format(approve ? t.videos.approved : t.videos.rejected, { name }));
    } catch (err) {
      setError(err as Error);
      setBusy(false);
    }
  };
  const selectId = `reason-${video.id}`;
  return (
    <li className="video-card" aria-labelledby={`video-${video.id}`}>
      <h2 id={`video-${video.id}`} dir="auto">
        {name}
      </h2>
      <p className="muted">
        {t.videos.prompt}: {promptLabel} · {t.videos.submitted}:{' '}
        {new Date(video.submittedAt).toLocaleString(locale)}
      </p>
      <ProtectedImage
        path={video.posterUrl}
        alt={format(t.videos.watch, { name })}
        className="review-video"
      />
      <ProtectedVideo path={video.url} label={format(t.videos.watch, { name })} />
      {error ? <ErrorBox error={error} /> : null}
      <div className="actions">
        <button
          type="button"
          className="button small primary"
          disabled={busy}
          onClick={() => void decide(true)}
        >
          {t.videos.approve}
          <span className="visually-hidden"> {name}</span>
        </button>
        <label htmlFor={selectId}>{t.videos.reason}</label>
        <select
          id={selectId}
          value={reason}
          onChange={(e) => setReason(e.target.value as (typeof reasons)[number])}
        >
          {reasons.map((r) => (
            <option key={r} value={r}>
              {t.videos.reasons[r]}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="button small danger"
          disabled={busy}
          onClick={() => void decide(false)}
        >
          {t.videos.reject}
          <span className="visually-hidden"> {name}</span>
        </button>
      </div>
    </li>
  );
}

/** Phase 76h: videos waiting for a moderator. Every decision is in the audit log. */
export function Videos() {
  const { t } = useLocale();
  const list = useAsync(() => api.videos(), []);
  const [notice, setNotice] = useState<string>();
  const statusRef = useRef<HTMLParagraphElement>(null);
  const videos = list.data?.videos ?? [];
  return (
    <section aria-labelledby="videos-title">
      <h1 id="videos-title">{t.videos.title}</h1>
      <p className="help">{t.videos.intro}</p>
      <p className="help">{t.videos.legal}</p>
      <p
        ref={statusRef}
        tabIndex={-1}
        role="status"
        className={notice ? 'alert alert-ok' : 'visually-hidden'}
      >
        {notice ?? ''}
      </p>
      {list.loading && !list.data ? <Loading /> : null}
      {list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : null}
      {list.data && videos.length === 0 ? <p className="empty">{t.videos.empty}</p> : null}
      {videos.length > 0 ? (
        <ul className="video-cards">
          {videos.map((v) => (
            <VideoCard
              key={v.id}
              video={v}
              onDone={(text) => {
                setNotice(text);
                statusRef.current?.focus();
                list.reload();
              }}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
