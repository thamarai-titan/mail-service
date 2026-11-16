import { HttpStatus } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';

export const invalidRequest = (message: string) =>
  new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', message);

export const quotaExceeded = (remaining: number) =>
  new ApiError(
    HttpStatus.CONFLICT,
    'QUOTA_EXCEEDED',
    `Only ${remaining} more inbox${remaining === 1 ? '' : 'es'} can be active in this session.`,
    { remaining },
  );

export const domainUnavailable = () =>
  new ApiError(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'DOMAIN_UNAVAILABLE',
    'That mail domain is not available.',
  );

export const inboxCreationRateLimited = () =>
  new ApiError(
    HttpStatus.TOO_MANY_REQUESTS,
    'RATE_LIMITED',
    'Too many inboxes created. Try again later.',
  );

/** Also used when the inbox belongs to another session, so its existence is never revealed. */
export const inboxNotFound = () =>
  new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Inbox not found.');
