import { HttpStatus } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';

/** Also used when the attachment belongs to another session, so its existence is never revealed. */
export const attachmentNotFound = () =>
  new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Attachment not found.');

export const attachmentBlocked = () =>
  new ApiError(
    HttpStatus.FORBIDDEN,
    'ATTACHMENT_BLOCKED',
    'This attachment was blocked for safety and was not stored.',
  );
