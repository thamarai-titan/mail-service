import { HttpStatus } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';

/** No cookie at all: the frontend should create a session. */
export const noSession = () =>
  new ApiError(HttpStatus.UNAUTHORIZED, 'NO_SESSION', 'No session cookie.');

/** Unknown, expired or revoked token: the frontend should create a new session. */
export const sessionInvalid = () =>
  new ApiError(
    HttpStatus.UNAUTHORIZED,
    'SESSION_INVALID',
    'Session is unknown, expired or revoked.',
  );
