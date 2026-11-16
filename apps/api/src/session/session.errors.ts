import { HttpException, HttpStatus } from '@nestjs/common';

/** Error body shared by the API: the frontend switches on `code`. */
export class ApiError extends HttpException {
  constructor(status: HttpStatus, code: string, message: string) {
    super({ statusCode: status, code, message }, status);
  }
}

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
