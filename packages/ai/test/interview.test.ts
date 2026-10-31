// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import { parseSuggestion, suggestFromInterview } from '../src/interview.js';
import type { TextModel } from '../src/llm.js';

const recording = (reply: string) => {
  const sent: string[] = [];
  const model: TextModel = {
    name: 'fake',
    external: false,
    async complete({ user }) {
      sent.push(user);
      return reply;
    },
  };
  return { model, sent };
};

describe('interview suggestions (phase 75c)', () => {
  it('keeps only valid values, each field on its own', () => {
    expect(
      parseSuggestion(
        'Sure: {"interests": ["hiking", "hiking", "astrology", "cooking"], "smoking": "no", ' +
          '"drinking": "lots", "children": "want", "religion": "orthodox"}',
      ),
    ).toEqual({
      interests: ['hiking', 'cooking'],
      smoking: 'no',
      drinking: null,
      children: 'want',
    });
    expect(parseSuggestion('not json')).toEqual({
      interests: [],
      children: null,
      smoking: null,
      drinking: null,
    });
  });

  it('sends only usable answers, never contact details or abuse', async () => {
    const { model, sent } = recording('{"interests": ["hiking"]}');
    const out = await suggestFromInterview(model, [
      { promptKey: 'perfect_sunday', answer: 'A long hike and coffee' },
      { promptKey: 'geek_out_about', answer: 'Call me at +972 50 123 4567' },
    ]);
    expect(out.interests).toEqual(['hiking']);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('A long hike');
    expect(sent[0]).not.toContain('972');
    const none = recording('{"interests": ["hiking"]}');
    expect(
      (
        await suggestFromInterview(none.model, [
          { promptKey: 'perfect_sunday', answer: 'see https://example.com' },
        ])
      ).interests,
    ).toEqual([]);
    expect(none.sent).toHaveLength(0);
  });
});
