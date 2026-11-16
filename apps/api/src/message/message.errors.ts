import { HttpStatus } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';

/** Also used when the message belongs to another session, so its existence is never revealed. */
export const messageNotFound = () =>
  new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Message not found.');
