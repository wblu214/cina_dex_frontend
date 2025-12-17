// HTTP client and typed API helpers for CINA Dex backend.
// Types and endpoints are derived from docs/frontend_api.md and docs/openapi.json.

export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

export interface PoolState {
  totalAssets: string;
  totalBorrowed: string;
  availableLiquidity: string;
  exchangeRate: string;
  totalFTokenSupply: string;
}

export interface Loan {
  id: number;
  borrower: string;
  collateralAmount: string;
  principal: string;
  repaymentAmount: string;
  startTime: number;
  duration: number;
  isActive: boolean;
}

export interface LoanHealth {
  ltv: string;
  isLiquidatable: boolean;
}

export interface UserPosition {
  address: string;
  loanIds: number[];
  totalPrincipal: string;
  totalRepayment: string;
  totalCollateral: string;
}

export interface TxCall {
  to: string;
  data: string;
  value: string;
}

export interface DepositTx {
  approve: TxCall;
  deposit: TxCall;
}

export interface BorrowTx {
  borrow: TxCall;
}

export interface RepayTx {
  approve: TxCall;
  repay: TxCall;
}

export interface LiquidateTx {
  approve: TxCall;
  liquidate: TxCall;
}

// MockUSDT mint tx (testnet helper).
export interface BuildMockUsdtMintRequest {
  to: string;
  // USDT amount in smallest units (6 decimals).
  amount: string;
}

// Use same-origin relative path and let Next.js proxy to the Go backend.
// This avoids browser CORS issues.
const API_BASE = "";

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`HTTP error: ${res.status}`);
  }
  const json = (await res.json()) as ApiResponse<T>;
  if (json.code !== 0) {
    throw new Error(json.message || "api error");
  }
  return json.data;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`HTTP error: ${res.status}`);
  }
  const json = (await res.json()) as ApiResponse<T>;
  if (json.code !== 0) {
    throw new Error(json.message || "api error");
  }
  return json.data;
}

// Simple wrappers for backend endpoints.

export async function getHealth(): Promise<Record<string, unknown>> {
  return apiGet<Record<string, unknown>>("/api/v1/health");
}

export async function getPoolState(): Promise<PoolState> {
  return apiGet<PoolState>("/api/v1/pool/state");
}

export async function getUserPosition(
  address: string
): Promise<UserPosition> {
  return apiGet<UserPosition>(`/api/v1/users/${address}/position`);
}

export async function getUserLoans(address: string): Promise<Loan[]> {
  return apiGet<Loan[]>(`/api/v1/users/${address}/loans`);
}

export async function getLoan(loanId: number): Promise<Loan> {
  return apiGet<Loan>(`/api/v1/loans/${loanId}`);
}

export async function getLoanHealth(loanId: number): Promise<LoanHealth> {
  return apiGet<LoanHealth>(`/api/v1/loans/${loanId}/health`);
}

export interface BuildDepositRequest {
  userAddress?: string;
  amount: string; // USDT in smallest units (6 decimals).
}

export async function buildDepositTx(
  payload: BuildDepositRequest
): Promise<DepositTx> {
  return apiPost<DepositTx>("/api/v1/tx/deposit", payload);
}

export interface BuildBorrowRequest {
  userAddress?: string;
  amount: string; // USDT in smallest units (6 decimals).
  duration: number; // seconds
  collateralWei: string; // BNB collateral in wei.
}

export async function buildBorrowTx(
  payload: BuildBorrowRequest
): Promise<BorrowTx> {
  return apiPost<BorrowTx>("/api/v1/tx/borrow", payload);
}

export interface BuildRepayRequest {
  userAddress?: string;
  loanId: number;
}

export async function buildRepayTx(
  payload: BuildRepayRequest
): Promise<RepayTx> {
  return apiPost<RepayTx>("/api/v1/tx/repay", payload);
}

export interface BuildLiquidateRequest {
  userAddress?: string;
  loanId: number;
}

export async function buildLiquidateTx(
  payload: BuildLiquidateRequest
): Promise<LiquidateTx> {
  return apiPost<LiquidateTx>("/api/v1/tx/liquidate", payload);
}

export async function buildMockUsdtMintTx(
  payload: BuildMockUsdtMintRequest
): Promise<TxCall> {
  return apiPost<TxCall>("/api/v1/tx/mock-usdt/mint", payload);
}
