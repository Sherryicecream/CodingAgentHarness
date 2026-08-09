import type { Request } from 'express';

const isLoopbackAddress = (value: string | undefined): boolean => {
  if (!value) {
    return false;
  }
  const normalized = value.toLowerCase().replace(/^::ffff:/, '');
  return normalized === '::1'
    || normalized === '127.0.0.1'
    || normalized.startsWith('127.');
};

export const isSecureByokRequest = (req: Request): boolean => (
  req.secure
  || isLoopbackAddress(req.ip || req.socket.remoteAddress)
);
