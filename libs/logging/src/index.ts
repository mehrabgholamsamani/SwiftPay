import pino from 'pino';
export const logger = pino({
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'authorization',
      'password',
      'passwordHash',
      'refreshToken',
      'accessToken',
    ],
    censor: '[REDACTED]',
  },
});

export const serviceLogger = (service: string) => logger.child({ service });
