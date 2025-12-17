# CINA Dex 前端（Next.js）API 调用指南

本文档面向 **Next.js 前端**，说明如何调用本仓库提供的 HTTP 接口，以及推荐的封装方式。

后端是一个无状态 REST API，所有接口均以 JSON 交互。

---

# CINA Dex On‑Chain API 

## 0. 这个项目在做什么？

这是一个**简单版的 DeFi 借贷池**，目前部署在 BSC 上：

- 抵押物：当前链的**原生币**（在 BSC 上是 **BNB**）  
- 借款资产：USDT（BSC 主网用真实 USDT，测试网用 MockUSDT）
- 用户角色：
  - **存款人（LP）**：存入 USDT，获得 LP 份额 `FToken(cUSDT)`，赚利息；
  - **借款人**：抵押 BNB，按固定利率借出 USDT；
  - **清算人**：当借款人风险过高时，清算人代还借款，获得一部分抵押品奖励。

协议的核心逻辑：

1. **存款 / 提取**  
   - 用户调用 `LendingPool.deposit(amount)` 存入 USDT。  
   - 池子按当前汇率铸造 FToken 给用户，记录他在池中的份额。  
   - 汇率通过 `getExchangeRate()` 动态变化，利息收入体现在 FToken 对 USDT 的兑换比例上涨。

2. **抵押借款**  
   - 借款人发送 BNB（`msg.value`），并调用 `borrow(amount, duration)`。  
   - 合约通过链上预言机（`ChainlinkOracle` + BNB/USD 价格）计算抵押物的美元价值，按最大 LTV（75%）判断能借多少 USDT。  
   - 借款成功后，合约把 USDT 转给借款人，并在内部记录一条 `Loan`（包含本金、利息、抵押量、期限等）。

3. **还款**  
   - 借款人在到期前后任何时候可以 `repay(loanId)`。  
   - 需要先对 USDT `approve` 足够额度。  
   - 合约收到应还总额（本金 + 利息）后，将抵押的 BNB 全部返还给借款人，并把贷款标记为已结清。

4. **清算**  
   - 如果价格下跌导致贷款的 **债务/抵押价值** 超过清算阈值（80%），任何人都可以调用 `liquidate(loanId)`：  
     - 清算人代借款人一次性还清全部 USDT；  
     - 清算人按“债务价值 × 104%”的规模获得一部分抵押 BNB；  
     - 剩余抵押，如果还有，退给借款人。  
   - 这样 LP 的资金安全有保障，清算人也有激励。

## 1. 运行环境与 Base URL

默认监听地址：

- 本地开发：`http://localhost:8080`（由 `.env` 中的 `HTTP_PORT` 决定）

前端（Next.js）建议在 `.env.local` 中配置：

```bash
NEXT_PUBLIC_CINA_API_BASE_URL=http://localhost:8080
```

Next.js 代码中统一使用：

```ts
const API_BASE =
  process.env.NEXT_PUBLIC_CINA_API_BASE_URL ?? "http://localhost:8080";
```

> 建议：**尽量在 Next.js 服务端环境调用后端 API**（例如 Route Handler、`getServerSideProps`、Server Components），避免浏览器直接跨域请求。如果需要浏览器直连，请在 Go 后端增加 CORS 中间件。

---

## 2. 通用约定

### 2.1 响应包装结构

所有接口返回统一包装：

```json
{
  "code": 0,
  "message": "success",
  "data": { ...具体数据... }
}
```

- `code = 0`：业务成功；
- `code != 0`：业务错误（如参数错误、链上调用失败等），`message` 为错误信息。

前端应同时检查：

1. HTTP 状态码（`res.ok`），以及
2. JSON 中的 `code` 字段。

### 2.2 通用头与编码

- 请求头：`Content-Type: application/json`（所有 `POST` 接口）
- 编码：UTF-8
- 所有金额/数值字段统一使用 **字符串** 表示，单位为 **最小单位**：
  - USDT：6 位小数，例如 `1000.000000 USDT = "1000000000"`
  - BNB（抵押）：`wei`，例如 `1 BNB = "1000000000000000000"`

---

## 3. 接口总览

Base path：`/api/v1`

| 功能             | 方法 | 路径                                 | 说明                          |
| ---------------- | ---- | ------------------------------------ | ----------------------------- |
| 健康检查         | GET  | `/api/v1/health`                     | 服务存活检测                  |
| 池子整体状态     | GET  | `/api/v1/pool/state`                 | 供首页/看板展示               |
| 用户整体仓位     | GET  | `/api/v1/users/{address}/position`   | 用户总本金/总还款/总抵押      |
| 用户贷款列表     | GET  | `/api/v1/users/{address}/loans`      | 用户所有 Loan 列表            |
| 单笔贷款详情     | GET  | `/api/v1/loans/{loanId}`             | 借款详情                      |
| 单笔贷款健康度   | GET  | `/api/v1/loans/{loanId}/health`      | LTV 与是否可清算              |
| 构造存款交易     | POST | `/api/v1/tx/deposit`                 | 返回 approve + deposit 调用   |
| 构造借款交易     | POST | `/api/v1/tx/borrow`                  | 返回 borrow 调用（带 BNB 抵押） |
| 构造还款交易     | POST | `/api/v1/tx/repay`                   | 返回 approve + repay 调用     |
| 构造清算交易     | POST | `/api/v1/tx/liquidate`               | 返回 approve + liquidate 调用 |

---

## 4. 数据结构（前端可参考的 TypeScript 类型）

结合 `internal/model/model.go` 与 OpenAPI，可在前端定义以下类型（示意）：

```ts
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
```

---

## 5. 各接口请求说明与 Next.js 调用示例

下面示例假设有工具函数：

```ts
const API_BASE =
  process.env.NEXT_PUBLIC_CINA_API_BASE_URL ?? "http://localhost:8080";

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
```

### 5.1 健康检查：`GET /api/v1/health`

无参数。

示例：

```ts
export async function getHealth() {
  return apiGet<Record<string, unknown>>("/api/v1/health");
}
```

返回示例：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "status": "ok"
  }
}
```

### 5.2 池子状态：`GET /api/v1/pool/state`

示例：

```ts
export async function getPoolState(): Promise<PoolState> {
  return apiGet<PoolState>("/api/v1/pool/state");
}
```

### 5.3 用户仓位：`GET /api/v1/users/{address}/position`

路径参数：

- `address`：用户地址（`0x...`）

示例：

```ts
export async function getUserPosition(address: string): Promise<UserPosition> {
  return apiGet<UserPosition>(`/api/v1/users/${address}/position`);
}
```

### 5.4 用户贷款列表：`GET /api/v1/users/{address}/loans`

```ts
export async function getUserLoans(address: string): Promise<Loan[]> {
  return apiGet<Loan[]>(`/api/v1/users/${address}/loans`);
}
```

### 5.5 单笔贷款详情：`GET /api/v1/loans/{loanId}`

```ts
export async function getLoan(loanId: number): Promise<Loan> {
  return apiGet<Loan>(`/api/v1/loans/${loanId}`);
}
```

### 5.6 单笔贷款健康度：`GET /api/v1/loans/{loanId}/health`

```ts
export async function getLoanHealth(loanId: number): Promise<LoanHealth> {
  return apiGet<LoanHealth>(`/api/v1/loans/${loanId}/health`);
}
```

### 5.7 构造存款交易：`POST /api/v1/tx/deposit`

请求体：

```json
{
  "userAddress": "0x...",          // 可选，后端当前未使用，仅做对齐
  "amount": "1000000000"           // 必填，USDT 数量（最小单位，6 decimals）
}
```

示例：

```ts
export interface BuildDepositRequest {
  userAddress?: string;
  amount: string; // USDT 最小单位
}

export async function buildDepositTx(
  payload: BuildDepositRequest
): Promise<DepositTx> {
  return apiPost<DepositTx>("/api/v1/tx/deposit", payload);
}
```

返回的 `DepositTx` 包含两笔调用：

- `approve`：对 USDT（或 MockUSDT）授权给 LendingPool；
- `deposit`：真正的 `deposit(uint256 amount)` 调用。

前端可将这两个 `TxCall` 按顺序交给钱包（例如 wagmi/ethers.js）发送。

### 5.8 构造借款交易：`POST /api/v1/tx/borrow`

请求体：

```json
{
  "userAddress": "0x...",               // 可选
  "amount": "100000000",                // 必填，USDT 借款额（最小单位）
  "duration": 86400,                    // 必填，借款时长（秒）
  "collateralWei": "1000000000000000000"// 必填，BNB 抵押量（wei）
}
```

示例：

```ts
export interface BuildBorrowRequest {
  userAddress?: string;
  amount: string;       // USDT 最小单位
  duration: number;     // 秒
  collateralWei: string;// BNB 抵押（wei）
}

export async function buildBorrowTx(
  payload: BuildBorrowRequest
): Promise<BorrowTx> {
  return apiPost<BorrowTx>("/api/v1/tx/borrow", payload);
}
```

返回的 `BorrowTx.borrow.value` 即应该作为交易的 `value`（BNB 抵押），`to` 和 `data` 用于调用 `borrow(amount,duration)`。

### 5.9 构造还款交易：`POST /api/v1/tx/repay`

请求体：

```json
{
  "userAddress": "0x...", // 可选
  "loanId": 1             // 必填，Loan ID
}
```

示例：

```ts
export interface BuildRepayRequest {
  userAddress?: string;
  loanId: number;
}

export async function buildRepayTx(
  payload: BuildRepayRequest
): Promise<RepayTx> {
  return apiPost<RepayTx>("/api/v1/tx/repay", payload);
}
```

返回的 `RepayTx` 同样包含两笔调用：`approve` + `repay`。

### 5.10 构造清算交易：`POST /api/v1/tx/liquidate`

请求体：

```json
{
  "userAddress": "0x...", // 可选
  "loanId": 1             // 必填，Loan ID
}
```

示例：

```ts
export interface BuildLiquidateRequest {
  userAddress?: string;
  loanId: number;
}

export async function buildLiquidateTx(
  payload: BuildLiquidateRequest
): Promise<LiquidateTx> {
  return apiPost<LiquidateTx>("/api/v1/tx/liquidate", payload);
}
```

---

## 6. 在 Next.js 中的推荐使用方式

### 6.1 使用 Route Handlers（Next.js App Router）

例如：在 `app/api/pool/state/route.ts` 中包装后端接口：

```ts
// app/api/pool/state/route.ts
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const data = await getPoolState(); // 调用上文封装的 api 函数
    return NextResponse.json({ code: 0, data });
  } catch (e: any) {
    return NextResponse.json(
      { code: 1, message: e?.message ?? "internal error" },
      { status: 500 }
    );
  }
}
```

前端页面只请求同源的 `/api/...`，不会出现跨域问题。

### 6.2 使用 Server Components / `getServerSideProps`

如果使用 Server Components，可以在组件中直接 `await getPoolState()`。  
如果使用 Pages Router，可以在 `getServerSideProps` 中调用封装好的函数，并把数据透传给页面。

---

通过以上约定与示例，前端只需依赖 `NEXT_PUBLIC_CINA_API_BASE_URL` 和统一的 `ApiResponse<T>` 包装，即可安全、稳定地调用当前 Go 后端所有接口。若后续接口有变更，请同步更新本文件与 `docs/openapi.json`。

