/// <reference types="vite/client" />
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** Set for the single-file demo preview: in-memory routing, demo AI, no service worker. */
  readonly VITE_PREVIEW?: string;
}
