// OAuth errors, answered in the shape OAuth clients expect: { error, error_description }.

/** The error codes from RFC 6749, RFC 7591 (registration) and RFC 8707 (resource indicators). */
export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unsupported_grant_type'
  | 'unsupported_response_type'
  | 'invalid_scope'
  | 'invalid_target'
  | 'access_denied'
  | 'invalid_redirect_uri'
  | 'invalid_client_metadata'

export class OAuthError extends Error {
  constructor(
    readonly code: OAuthErrorCode,
    message: string,
    /** invalid_client is 401 (RFC 6749 section 5.2); everything else is 400. */
    readonly status = code === 'invalid_client' ? 401 : 400,
  ) {
    super(message)
  }

  toJSON(): { error: OAuthErrorCode; error_description: string } {
    return { error: this.code, error_description: this.message }
  }
}
