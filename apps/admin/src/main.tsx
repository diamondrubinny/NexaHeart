// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
// Phase 79: Rubik (variable weight), split by script and bundled: no request to Google.
import '@fontsource-variable/rubik/wght.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
