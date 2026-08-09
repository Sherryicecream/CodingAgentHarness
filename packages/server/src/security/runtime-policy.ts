export type RuntimeMode = 'public' | 'local';

export type RuntimeExperience = 'demo' | 'byok' | 'server';

export interface RuntimePolicy {
  readonly mode: RuntimeMode;
  readonly allowServerCredentials: boolean;
  readonly allowByok: boolean;
  readonly allowProcessTools: boolean;
  readonly allowHttpByok: boolean;
  readonly allowedExperiences: readonly RuntimeExperience[];
}

export const PUBLIC_RUNTIME_POLICY: RuntimePolicy = Object.freeze({
  mode: 'public',
  allowServerCredentials: false,
  allowByok: false,
  allowProcessTools: false,
  allowHttpByok: false,
  allowedExperiences: Object.freeze(['demo'] as const),
});

export const LOCAL_RUNTIME_POLICY: RuntimePolicy = Object.freeze({
  mode: 'local',
  allowServerCredentials: true,
  allowByok: true,
  allowProcessTools: true,
  allowHttpByok: process.env.HARNESS_ALLOW_HTTP_BYOK === 'true',
  allowedExperiences: Object.freeze(['demo', 'byok', 'server'] as const),
});

export const resolveRuntimePolicy = (value?: string): RuntimePolicy => (
  value === 'local' ? LOCAL_RUNTIME_POLICY : PUBLIC_RUNTIME_POLICY
);
