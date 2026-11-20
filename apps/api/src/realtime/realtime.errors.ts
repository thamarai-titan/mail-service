import { HttpStatus } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';

export const tooManyStreams = () =>
  new ApiError(
    HttpStatus.TOO_MANY_REQUESTS,
    'TOO_MANY_STREAMS',
    'Too many open tabs for this session. Close one and try again.',
  );
