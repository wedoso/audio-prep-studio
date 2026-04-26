/// <reference types="vite/client" />

import type { AudioAppApi } from '../../preload';

declare global {
  interface Window {
    audioApp: AudioAppApi;
  }
}
