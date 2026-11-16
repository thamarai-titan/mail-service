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
