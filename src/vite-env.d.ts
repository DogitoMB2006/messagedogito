/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_INSFORGE_URL?: string;
  readonly VITE_INSFORGE_ANON_KEY?: string;
  readonly VITE_GIPHY_API_KEY?: string;
  readonly VITE_STUN_URLS?: string;
  readonly VITE_TURN_URLS?: string;
  readonly VITE_TURN_USERNAME?: string;
  readonly VITE_TURN_CREDENTIAL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
