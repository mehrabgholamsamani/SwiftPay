import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().positive(),
  KAFKA_BROKERS: z.string().min(1),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});
export type ServiceConfig = z.infer<typeof schema>;
export const validateConfig = (input: Record<string, string | undefined>): ServiceConfig =>
  schema.parse(input);

/** Validates the environment every service needs during the platform-foundation stage. */
export const loadServiceConfig = (input: NodeJS.ProcessEnv = process.env): ServiceConfig =>
  validateConfig(input);
