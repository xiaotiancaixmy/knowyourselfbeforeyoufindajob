export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends AppError {
  constructor(message: string) {
    super(message, 400);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409);
  }
}

export class UnprocessableEntityError extends AppError {
  constructor(message: string) {
    super(message, 422);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message: string) {
    super(message, 503);
  }
}
