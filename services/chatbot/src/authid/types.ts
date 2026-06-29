/**
 * Types for the AuthID Identity Service integration.
 * Mirrors the verbatim API shapes documented in
 * legacy/superpowers/specs/2026-06-02-authid-integration-research.md.
 */

export interface AuthIdTokenResponse {
  AccessToken: string;
  RefreshToken: string;
  /** ISO8601 expiry of the AccessToken, e.g. "2026-06-11T02:03:05.0Z".
   *  AuthID's real TTL is ~15min, shorter than any fixed guess. */
  AccessTokenExpirationDate?: string;
}

export interface CreateProofTransactionRequest {
  AccountNumber: string;
  Payload: { DocumentTypes: string[] };
  Name: "GetForeignIDDocument";
  Timeout: number;
  TransportType: 0;
}

export interface CreateProofTransactionResponse {
  OperationId: string;
  OneTimeSecret: string;
}

export interface CreateVerifiedTransactionRequest {
  AccountNumber: string;
  Name: "Verify_Identity";
  Timeout: number;
  ConfirmationPolicy: {
    TransportType: 0;
    CredentialType: 1;
    BioPolicy: { CheckLiveness: true };
  };
}

export interface CreateVerifiedTransactionResponse {
  TransactionId: string;
  OneTimeSecret: string;
}

export interface OperationStatusResponse {
  Status: 0 | 1 | 2 | 3 | 4;
}

export interface ProofResultRaw {
  Name: string;
  OperationId: string;
  Payload: {
    Data: {
      VerificationSteps: Record<string, unknown>;
      Document: {
        Description: string;
        Type: string;
        CapMethod: number;
        RawData: Array<Record<string, unknown>>;
        Data: Array<{ Key: string; Value: string }>;
        FacialImage?: string;
      };
      Matched: boolean;
      MatchProbabilty: number;
      MatchScore: number;
      LivenessDetectionResult: { IsLive: boolean };
      BarcodeSecurity?: "PASS" | "FAIL";
      padResult?: "PASS" | "FAIL";
      documentInjectionAttackDetectionResult?: "PASS" | "FAIL";
      selfieInjectionAttackDetectionResult?: "PASS" | "FAIL";
      mismatchMrzOcr?: boolean;
      DateOfExpiry?: string;
    };
  };
}

export interface ExtractedIdentity {
  fullName?: string;
  dateOfBirth?: string;
  address?: string;
}

export interface Decision {
  outcome: "pass" | "review" | "reject";
  reasons: string[];
}
