declare module '@harness/server' {
  export interface HarnessApp {
    close(): Promise<void>;
  }

  export function startServer(): Promise<HarnessApp>;
}
