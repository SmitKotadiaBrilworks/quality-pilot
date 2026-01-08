/// <reference types="next" />
/// <reference types="next/image-types/global" />

declare namespace NodeJS {
  interface ProcessEnv {
    NEXT_PUBLIC_WS_URL?: string;
    NEXT_PUBLIC_API_URL?: string;
  }
}
