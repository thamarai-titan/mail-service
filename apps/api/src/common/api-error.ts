import { HttpException, HttpStatus } from '@nestjs/common';

/** Error body shared by the API: the frontend switches on `code`. */
export class ApiError extends HttpException {
  constructor(
    status: HttpStatus,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super({ statusCode: status, code, message, ...details }, status);
  }
}

export const validationError = (message: string) =>
  new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', message);

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
