// utils/errors.ts — every error the API can deliberately return.
// Services throw these; middleware/error.middleware.ts is the only place
// that turns them into HTTP responses.

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string
  ) {
    super(message ?? code);
    this.name = "AppError";
  }
}

export const badRequest = (code: string, message?: string) => new AppError(400, code, message);
export const notFound = (code = "not_found") => new AppError(404, code);

// ---- domain errors -------------------------------------------------------

export class EmailInUseError extends AppError {
  constructor() {
    super(409, "email_in_use", "An account with this email already exists.");
    this.name = "EmailInUseError";
  }
}

export class InvalidCredentialsError extends AppError {
  constructor() {
    super(401, "invalid_credentials", "Invalid email or password.");
    this.name = "InvalidCredentialsError";
  }
}

export class InvalidSiteKeyError extends AppError {
  constructor() {
    super(401, "invalid_site_key", "Invalid or unknown site key.");
    this.name = "InvalidSiteKeyError";
  }
}

export class DatabaseNotConfiguredError extends AppError {
  constructor() {
    super(503, "database_not_configured", "DATABASE_URL is not set. Add it to .env to connect a Postgres database.");
    this.name = "DatabaseNotConfiguredError";
  }
}
