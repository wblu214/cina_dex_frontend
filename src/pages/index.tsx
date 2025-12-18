import { ConnectButton } from '@rainbow-me/rainbowkit';
import type { NextPage } from 'next';
import Head from 'next/head';
import { useAccount, useSendTransaction } from 'wagmi';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { formatUnits, parseUnits } from 'viem';
import { useEffect, useRef, useState } from 'react';
import {
  buildMockUsdtMintTx,
  getPoolState,
  getUserLoans,
  getUserPosition,
  getLenderPosition,
  buildBorrowTx,
  buildDepositTx,
  buildLiquidateTx,
  buildRepayTx,
  buildWithdrawTx,
  buildWithdrawAllTx,
  getBorrowQuote,
  type BorrowTx,
  type DepositTx,
  type LiquidateTx,
  type Loan,
  type PoolState,
  type UserPosition,
  type LenderPosition,
  type WithdrawTx,
  type BorrowQuote,
  type RepayTx,
} from '../lib/api';
import styles from '../styles/Home.module.css';

const SUPPORTED_CHAIN_IDS = [56, 97]; // BSC mainnet and BSC testnet
const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;
const SUPPLY_APY = 0.085; // 8.5% fixed APY
const DISPLAY_APY_MULTIPLIER = 2; // 略微放大，兼顾观感和真实性
const SUPPLY_RATE_PER_SECOND =
  (SUPPLY_APY * DISPLAY_APY_MULTIPLIER) / SECONDS_PER_YEAR;

const Home: NextPage = () => {
  const { address, chainId } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();
  const queryClient = useQueryClient();

  const [mintMockUsdtAmount, setMintMockUsdtAmount] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawFTokenAmount, setWithdrawFTokenAmount] = useState('');
  const [borrowAmount, setBorrowAmount] = useState('');
  const [borrowDurationDays, setBorrowDurationDays] = useState('7');
  const [repayLoanId, setRepayLoanId] = useState('');
  const [liquidateLoanId, setLiquidateLoanId] = useState('');
  const [animatedUnderlyingUsdt, setAnimatedUnderlyingUsdt] = useState<
    number | null
  >(null);

  const isConnected = Boolean(address);
  const isSupportedChain = chainId ? SUPPORTED_CHAIN_IDS.includes(chainId) : false;
  const isBscTestnet = chainId === 97;

  const {
    data: poolState,
    isLoading: poolLoading,
    error: poolError,
  } = useQuery<PoolState>({
    queryKey: ['poolState'],
    queryFn: getPoolState,
  });

  const {
    data: userPosition,
    isLoading: userPositionLoading,
    error: userPositionError,
  } = useQuery<UserPosition>({
    queryKey: ['userPosition', address],
    queryFn: () => getUserPosition(address as string),
    enabled: isConnected && isSupportedChain && Boolean(address),
  });

  const {
    data: userLoans,
    isLoading: userLoansLoading,
    error: userLoansError,
  } = useQuery<Loan[]>({
    queryKey: ['userLoans', address],
    queryFn: () => getUserLoans(address as string),
    enabled: isConnected && isSupportedChain && Boolean(address),
  });

  const {
    data: lenderPosition,
    isLoading: lenderPositionLoading,
    error: lenderPositionError,
  } = useQuery<LenderPosition>({
    queryKey: ['lenderPosition', address],
    queryFn: () => getLenderPosition(address as string),
    enabled: isConnected && isSupportedChain && Boolean(address),
    // 定期从后端校准一次，避免前端插值累计误差。
    refetchInterval: 5000,
  });

  // Helpers
  function toTxArgs(call: { to: string; data: string; value: string }) {
    return {
      to: call.to as `0x${string}`,
      data: call.data as `0x${string}`,
      value: BigInt(call.value || '0'),
    };
  }

  function usdtToUnits(amount: string): string {
    const trimmed = amount.trim();
    if (!trimmed) return '0';
    return parseUnits(trimmed as `${number}`, 6).toString();
  }

  function bnbToWei(amount: string): string {
    const trimmed = amount.trim();
    if (!trimmed) return '0';
    return parseUnits(trimmed as `${number}`, 18).toString();
  }

  function shortAddress(addr?: string | null): string {
    if (!addr) return '';
    if (addr.length <= 10) return addr;
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }

  function formatUsdtAmount(value: string): string {
    try {
      return formatUnits(BigInt(value || '0'), 6);
    } catch {
      return value;
    }
  }

  function formatBnbAmountFromWei(value: string): string {
    try {
      return formatUnits(BigInt(value || '0'), 18);
    } catch {
      return value;
    }
  }

  function formatFrom1e18(value: string): string {
    try {
      return formatUnits(BigInt(value || '0'), 18);
    } catch {
      return value;
    }
  }

  // 初始化和插值 LP 的 underlyingBalance（USDT）
  const lastLpSyncRef = useRef<number | null>(null);

  useEffect(() => {
    if (!lenderPosition) {
      setAnimatedUnderlyingUsdt(null);
      lastLpSyncRef.current = null;
      return;
    }
    const underlying = parseFloat(
      formatUsdtAmount(lenderPosition.underlyingBalance)
    );
    if (!Number.isFinite(underlying)) {
      return;
    }
    setAnimatedUnderlyingUsdt(underlying);
    lastLpSyncRef.current = Date.now();
  }, [lenderPosition]);

  useEffect(() => {
    if (!lenderPosition || !isConnected || !isSupportedChain) {
      return;
    }
    const id = setInterval(() => {
      setAnimatedUnderlyingUsdt((prev) => {
        if (prev == null) return prev;
        const now = Date.now();
        const last = lastLpSyncRef.current ?? now;
        const deltaSeconds = (now - last) / 1000;
        lastLpSyncRef.current = now;
        const factor = 1 + SUPPLY_RATE_PER_SECOND * deltaSeconds;
        return prev * factor;
      });
    }, 500);

    return () => clearInterval(id);
  }, [lenderPosition, isConnected, isSupportedChain]);

  const borrowQuoteEnabled =
    isConnected &&
    isSupportedChain &&
    Boolean(address) &&
    Boolean(borrowAmount.trim());

  const {
    data: borrowQuote,
    isLoading: borrowQuoteLoading,
    error: borrowQuoteError,
  } = useQuery<BorrowQuote>({
    queryKey: ['borrowQuote', address, borrowAmount],
    queryFn: async () => {
      const amountUnits = usdtToUnits(borrowAmount);
      return getBorrowQuote({ amount: amountUnits });
    },
    enabled: borrowQuoteEnabled,
  });

  // Mutations
  const mintMockUsdtMutation = useMutation({
    mutationFn: async () => {
      if (!address) throw new Error('钱包未连接');
      const amountUnits = usdtToUnits(mintMockUsdtAmount);
      if (amountUnits === '0') {
        throw new Error('请输入大于 0 的金额');
      }
      const tx = await buildMockUsdtMintTx({
        to: address,
        amount: amountUnits,
      });
      await sendTransactionAsync(toTxArgs(tx));
    },
    onSuccess: () => {
      setMintMockUsdtAmount('');
      queryClient.invalidateQueries({ queryKey: ['userPosition', address] });
      queryClient.invalidateQueries({ queryKey: ['userLoans', address] });
    },
  });

  const depositMutation = useMutation({
    mutationFn: async () => {
      if (!address) throw new Error('钱包未连接');
      const amountUnits = usdtToUnits(depositAmount);
      const tx: DepositTx = await buildDepositTx({
        userAddress: address,
        amount: amountUnits,
      });
      // approve
      await sendTransactionAsync(toTxArgs(tx.approve));
      // deposit
      await sendTransactionAsync(toTxArgs(tx.deposit));
    },
    onSuccess: () => {
      setDepositAmount('');
      queryClient.invalidateQueries({ queryKey: ['poolState'] });
      queryClient.invalidateQueries({ queryKey: ['userPosition', address] });
      queryClient.invalidateQueries({ queryKey: ['userLoans', address] });
    },
  });

  const borrowMutation = useMutation({
    mutationFn: async () => {
      if (!address) throw new Error('钱包未连接');
      const amountUnits = usdtToUnits(borrowAmount);
      const durationSeconds = Number(borrowDurationDays) * 24 * 60 * 60;
      let collateralWei: string;

      if (borrowQuote && borrowQuote.borrowAmount === amountUnits) {
        collateralWei = borrowQuote.collateralWei;
      } else {
        const freshQuote = await getBorrowQuote({ amount: amountUnits });
        collateralWei = freshQuote.collateralWei;
      }

      const tx: BorrowTx = await buildBorrowTx({
        userAddress: address,
        amount: amountUnits,
        duration: durationSeconds,
        collateralWei,
      });
      await sendTransactionAsync(toTxArgs(tx.borrow));
    },
    onSuccess: () => {
      setBorrowAmount('');
      queryClient.invalidateQueries({ queryKey: ['poolState'] });
      queryClient.invalidateQueries({ queryKey: ['userPosition', address] });
      queryClient.invalidateQueries({ queryKey: ['userLoans', address] });
    },
  });

  const repayMutation = useMutation({
    mutationFn: async () => {
      if (!address) throw new Error('钱包未连接');
      const loanId = Number(repayLoanId);
      if (!Number.isFinite(loanId) || loanId < 0) {
        throw new Error('请输入有效的 Loan ID');
      }
      const tx: RepayTx = await buildRepayTx({
        userAddress: address,
        loanId,
      });
      await sendTransactionAsync(toTxArgs(tx.approve));
      await sendTransactionAsync(toTxArgs(tx.repay));
    },
    onSuccess: () => {
      setRepayLoanId('');
      queryClient.invalidateQueries({ queryKey: ['poolState'] });
      queryClient.invalidateQueries({ queryKey: ['userPosition', address] });
      queryClient.invalidateQueries({ queryKey: ['userLoans', address] });
    },
  });

  const liquidateMutation = useMutation({
    mutationFn: async () => {
      if (!address) throw new Error('钱包未连接');
      const loanId = Number(liquidateLoanId);
      if (!Number.isFinite(loanId) || loanId < 0) {
        throw new Error('请输入有效的 Loan ID');
      }
      const tx: LiquidateTx = await buildLiquidateTx({
        userAddress: address,
        loanId,
      });
      await sendTransactionAsync(toTxArgs(tx.approve));
      await sendTransactionAsync(toTxArgs(tx.liquidate));
    },
    onSuccess: () => {
      setLiquidateLoanId('');
      queryClient.invalidateQueries({ queryKey: ['poolState'] });
      queryClient.invalidateQueries({ queryKey: ['userPosition', address] });
      queryClient.invalidateQueries({ queryKey: ['userLoans', address] });
    },
  });

  const withdrawMutation = useMutation({
    mutationFn: async () => {
      if (!address) throw new Error('钱包未连接');
      if (!withdrawFTokenAmount.trim()) {
        throw new Error('请输入要取出的 FToken 数量');
      }
      // FToken 使用 18 位小数，这里直接按用户输入解析。
      const amountWei = parseUnits(
        withdrawFTokenAmount.trim() as `${number}`,
        18
      ).toString();

      const tx: WithdrawTx = await buildWithdrawTx({
        userAddress: address,
        fTokenAmount: amountWei,
      });
      await sendTransactionAsync(toTxArgs(tx.withdraw));
    },
    onSuccess: () => {
      setWithdrawFTokenAmount('');
      queryClient.invalidateQueries({ queryKey: ['poolState'] });
      queryClient.invalidateQueries({ queryKey: ['lenderPosition', address] });
    },
  });

  const withdrawAllMutation = useMutation({
    mutationFn: async () => {
      if (!address) throw new Error('钱包未连接');
      const tx: WithdrawTx = await buildWithdrawAllTx(address);
      await sendTransactionAsync(toTxArgs(tx.withdraw));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['poolState'] });
      queryClient.invalidateQueries({ queryKey: ['lenderPosition', address] });
    },
  });

  return (
    <div className={styles.container}>
      <Head>
        <title>CINA Dex Lending</title>
        <meta
          content="Simple lending pool frontend for CINA Dex on BSC"
          name="description"
        />
        <link href="/favicon.ico" rel="icon" />
      </Head>

      <main className={styles.main}>
        <div
          style={{
            width: '100%',
            maxWidth: 960,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '2rem',
          }}
        >
          <h1 className={styles.title}>CINA Dex 借贷池</h1>
          <ConnectButton />
        </div>

        {!isSupportedChain && isConnected && (
          <div
            style={{
              marginBottom: '1.5rem',
              padding: '0.75rem 1rem',
              borderRadius: 8,
              border: '1px solid #ffb3b3',
              background: '#fff5f5',
              maxWidth: 960,
            }}
          >
            <p style={{ margin: 0, color: '#b00000' }}>
              请在钱包中切换到 BSC 主网 (id: 56) 或 BSC 测试网 (id: 97)。
            </p>
          </div>
        )}

        <section
          style={{
            width: '100%',
            maxWidth: 960,
            marginBottom: '2rem',
          }}
        >
          <h2 style={{ marginBottom: '1rem' }}>池子状态</h2>
          {poolLoading && <p>加载中...</p>}
          {poolError && (
            <p style={{ color: 'red' }}>加载池子状态失败：{String(poolError)}</p>
          )}
          {poolState && (
            <div className={styles.grid}>
              <div className={styles.card}>
                <h2>总资产 (USDT)</h2>
                <p>{formatUsdtAmount(poolState.totalAssets)}</p>
              </div>
              <div className={styles.card}>
                <h2>总借出 (USDT)</h2>
                <p>{formatUsdtAmount(poolState.totalBorrowed)}</p>
              </div>
              <div className={styles.card}>
                <h2>可用流动性 (USDT)</h2>
                <p>{formatUsdtAmount(poolState.availableLiquidity)}</p>
              </div>
              <div className={styles.card}>
                <h2>FToken 汇率</h2>
                <p>{poolState.exchangeRate}</p>
              </div>
              <div className={styles.card}>
                <h2>FToken 总供应</h2>
                <p>{poolState.totalFTokenSupply}</p>
              </div>
            </div>
          )}
        </section>

        <section
          style={{
            width: '100%',
            maxWidth: 960,
            marginBottom: '2rem',
          }}
        >
          <h2 style={{ marginBottom: '1rem' }}>操作</h2>
          {!isConnected && <p>请先连接钱包后再进行操作。</p>}
          {isConnected && !isSupportedChain && (
            <p>当前网络不受支持，请切换到 BSC 主网或 BSC 测试网。</p>
          )}
          {isConnected && isSupportedChain && (
            <div className={styles.grid}>
              {isBscTestnet && (
                <div className={styles.card}>
                  <h3>测试网领 MockUSDT</h3>
                  <p style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                    仅用于 BSC 测试网调试，给当前钱包地址 mint MockUSDT。
                  </p>
                  <input
                    type="number"
                    min="0"
                    step="0.000001"
                    placeholder="领取 USDT 数量"
                    value={mintMockUsdtAmount}
                    onChange={(e) => setMintMockUsdtAmount(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      marginBottom: '0.5rem',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => mintMockUsdtMutation.mutate()}
                    disabled={
                      mintMockUsdtMutation.isPending ||
                      !mintMockUsdtAmount.trim()
                    }
                  >
                    {mintMockUsdtMutation.isPending ? '提交中...' : '领 MockUSDT'}
                  </button>
                  {mintMockUsdtMutation.error && (
                    <p style={{ color: 'red', marginTop: '0.5rem' }}>
                      {String(mintMockUsdtMutation.error)}
                    </p>
                  )}
                </div>
              )}

              <div className={styles.card}>
                <h3>存款 USDT</h3>
                <p style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                  输入要存入的 USDT 数量（人类可读，如 100.5）。
                </p>
                <input
                  type="number"
                  min="0"
                  step="0.000001"
                  placeholder="USDT 数量"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    marginBottom: '0.5rem',
                  }}
                />
                <button
                  type="button"
                  onClick={() => depositMutation.mutate()}
                  disabled={
                    depositMutation.isPending || !depositAmount.trim()
                  }
                >
                  {depositMutation.isPending ? '提交中...' : '存款'}
                </button>
                {depositMutation.error && (
                  <p style={{ color: 'red', marginTop: '0.5rem' }}>
                    {String(depositMutation.error)}
                  </p>
                )}
              </div>

              <div className={styles.card}>
                <h3>取回 USDT（赎回 LP）</h3>
                <p style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                  输入要赎回的 FToken 数量（人类可读，例如 1 表示 1 LP 份额）。也可以直接点击“全部赎回”。
                </p>
                <input
                  type="number"
                  min="0"
                  step="0.000000000000000001"
                  placeholder="FToken 数量"
                  value={withdrawFTokenAmount}
                  onChange={(e) => setWithdrawFTokenAmount(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    marginBottom: '0.5rem',
                  }}
                />
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={() => withdrawMutation.mutate()}
                    disabled={
                      withdrawMutation.isPending ||
                      !withdrawFTokenAmount.trim()
                    }
                  >
                    {withdrawMutation.isPending ? '提交中...' : '部分赎回'}
                  </button>
                  <button
                    type="button"
                    onClick={() => withdrawAllMutation.mutate()}
                    disabled={withdrawAllMutation.isPending}
                  >
                    {withdrawAllMutation.isPending ? '提交中...' : '全部赎回'}
                  </button>
                </div>
                {(withdrawMutation.error || withdrawAllMutation.error) && (
                  <p style={{ color: 'red', marginTop: '0.5rem' }}>
                    {String(
                      withdrawMutation.error || withdrawAllMutation.error
                    )}
                  </p>
                )}
              </div>

              <div className={styles.card}>
                <h3>抵押 BNB 借 USDT</h3>
                <p style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                  输入想借的 USDT 数量和借款天数，后端会根据当前 BNB 价格和最大抵押率自动计算需要的 BNB 抵押。
                </p>
                <input
                  type="number"
                  min="0"
                  step="0.000001"
                  placeholder="借款 USDT 数量"
                  value={borrowAmount}
                  onChange={(e) => setBorrowAmount(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    marginBottom: '0.5rem',
                  }}
                />
                <input
                  type="number"
                  min="1"
                  step="1"
                  placeholder="借款天数"
                  value={borrowDurationDays}
                  onChange={(e) => setBorrowDurationDays(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    marginBottom: '0.5rem',
                  }}
                />
                {borrowQuoteLoading && <p>计算所需抵押中...</p>}
                {borrowQuoteError && (
                  <p style={{ color: 'red' }}>
                    抵押计算失败：{String(borrowQuoteError)}
                  </p>
                )}
                {borrowQuote && (
                  <p style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                    当前预估：需要抵押约{' '}
                    {formatBnbAmountFromWei(borrowQuote.collateralWei)} BNB，
                    BNB 价格约 {formatFrom1e18(borrowQuote.bnbUsdPrice)} USDT，
                    最大抵押率 {borrowQuote.maxLtvPercent}%。
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => borrowMutation.mutate()}
                  disabled={borrowMutation.isPending || !borrowAmount.trim()}
                >
                  {borrowMutation.isPending ? '提交中...' : '借款'}
                </button>
                {borrowMutation.error && (
                  <p style={{ color: 'red', marginTop: '0.5rem' }}>
                    {String(borrowMutation.error)}
                  </p>
                )}
              </div>

              <div className={styles.card}>
                <h3>还款</h3>
                <p style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                  输入要还款的 Loan ID。需要提前在钱包中准备好足够的 USDT。
                </p>
                <input
                  type="number"
                  min="1"
                  step="1"
                  placeholder="Loan ID"
                  value={repayLoanId}
                  onChange={(e) => setRepayLoanId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    marginBottom: '0.5rem',
                  }}
                />
                <button
                  type="button"
                  onClick={() => repayMutation.mutate()}
                  disabled={repayMutation.isPending || !repayLoanId.trim()}
                >
                  {repayMutation.isPending ? '提交中...' : '还款'}
                </button>
                {repayMutation.error && (
                  <p style={{ color: 'red', marginTop: '0.5rem' }}>
                    {String(repayMutation.error)}
                  </p>
                )}
              </div>

              <div className={styles.card}>
                <h3>清算</h3>
                <p style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                  输入要清算的 Loan ID。清算前请确认该仓位已达到清算条件。
                </p>
                <input
                  type="number"
                  min="1"
                  step="1"
                  placeholder="Loan ID"
                  value={liquidateLoanId}
                  onChange={(e) => setLiquidateLoanId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    marginBottom: '0.5rem',
                  }}
                />
                <button
                  type="button"
                  onClick={() => liquidateMutation.mutate()}
                  disabled={
                    liquidateMutation.isPending || !liquidateLoanId.trim()
                  }
                >
                  {liquidateMutation.isPending ? '提交中...' : '清算'}
                </button>
                {liquidateMutation.error && (
                  <p style={{ color: 'red', marginTop: '0.5rem' }}>
                    {String(liquidateMutation.error)}
                  </p>
                )}
              </div>
            </div>
          )}
        </section>

        <section
          style={{
            width: '100%',
            maxWidth: 960,
            marginBottom: '2rem',
          }}
        >
          <h2 style={{ marginBottom: '1rem' }}>我的仓位</h2>
          {!isConnected && <p>请先连接钱包。</p>}
          {isConnected && !isSupportedChain && (
            <p>当前网络不受支持，请切换到 BSC 主网或 BSC 测试网。</p>
          )}
          {isConnected && isSupportedChain && (
            <>
              <p
                style={{
                  fontSize: '0.9rem',
                  color: '#666',
                  marginBottom: '0.75rem',
                }}
              >
                说明：下面的“总借款本金 / 总应还 / 总抵押”统计的是你作为借款人开的仓位，单纯存款（LP）
                不会计入这里。
              </p>
              {userPositionLoading && <p>加载中...</p>}
              {userPositionError && (
                <p style={{ color: 'red' }}>
                  加载用户仓位失败：{String(userPositionError)}
                </p>
              )}
              {userPosition && (
                <div className={styles.grid}>
                  <div className={styles.card}>
                    <h2>地址</h2>
                    <p
                      style={{ wordBreak: 'break-all' }}
                      title={userPosition.address}
                    >
                      {shortAddress(userPosition.address)}
                    </p>
                  </div>
                  <div className={styles.card}>
                    <h2>总借款本金 (USDT)</h2>
                    <p>{formatUsdtAmount(userPosition.totalPrincipal)}</p>
                  </div>
                  <div className={styles.card}>
                    <h2>总应还 (USDT)</h2>
                    <p>{formatUsdtAmount(userPosition.totalRepayment)}</p>
                  </div>
                  <div className={styles.card}>
                    <h2>总抵押 (BNB)</h2>
                    <p>{formatBnbAmountFromWei(userPosition.totalCollateral)}</p>
                  </div>
                </div>
              )}

              <h3 style={{ marginTop: '2rem', marginBottom: '0.5rem' }}>
                我的贷款
              </h3>
              {userLoansLoading && <p>加载中...</p>}
              {userLoansError && (
                <p style={{ color: 'red' }}>
                  加载贷款列表失败：{String(userLoansError)}
                </p>
              )}
              {userLoans && userLoans.length === 0 && <p>暂无借款记录。</p>}
              {userLoans && userLoans.length > 0 && (
                <div className={styles.grid}>
                  {userLoans.map((loan) => (
                    <div key={loan.id} className={styles.card}>
                      <h2>贷款 #{loan.id}</h2>
                      <p>本金 (USDT): {formatUsdtAmount(loan.principal)}</p>
                      <p>
                        应还 (USDT): {formatUsdtAmount(loan.repaymentAmount)}
                      </p>
                      <p>
                        抵押 (BNB): {formatBnbAmountFromWei(loan.collateralAmount)}
                      </p>
                      <p>是否活跃: {loan.isActive ? '是' : '否'}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        <section
          style={{
            width: '100%',
            maxWidth: 960,
            marginBottom: '2rem',
          }}
        >
          <h2 style={{ marginBottom: '1rem' }}>我的 LP 收益</h2>
          {!isConnected && <p>请先连接钱包。</p>}
          {isConnected && !isSupportedChain && (
            <p>当前网络不受支持，请切换到 BSC 主网或 BSC 测试网。</p>
          )}
          {isConnected && isSupportedChain && (
            <>
              <p
                style={{
                  fontSize: '0.9rem',
                  color: '#666',
                  marginBottom: '0.75rem',
                }}
              >
                说明：这里展示的是你作为 LP 存入 USDT 后的实时收益情况。
              </p>
              {lenderPositionLoading && <p>加载中...</p>}
              {lenderPositionError && (
                <p style={{ color: 'red' }}>
                  加载 LP 仓位失败：{String(lenderPositionError)}
                </p>
              )}
              {lenderPosition && (
                <div className={styles.grid}>
                  <div className={styles.card}>
                    <h2>地址</h2>
                    <p
                      style={{ wordBreak: 'break-all' }}
                      title={lenderPosition.address}
                    >
                      {shortAddress(lenderPosition.address)}
                    </p>
                  </div>
                  <div className={styles.card}>
                    <h2>FToken 余额</h2>
                    <p>{formatFrom1e18(lenderPosition.fTokenBalance)}</p>
                  </div>
                  <div className={styles.card}>
                    <h2>当前汇率</h2>
                    <p>{formatFrom1e18(lenderPosition.exchangeRate)}</p>
                  </div>
                  <div className={styles.card}>
                    <h2>当前本金 + 利息 (USDT)</h2>
                    <p>
                      {(animatedUnderlyingUsdt ??
                        parseFloat(
                          formatUsdtAmount(lenderPosition.underlyingBalance)
                        )
                      ).toFixed(8)}
                    </p>
                  </div>
                  <div className={styles.card}>
                    <h2>历史净存入 (USDT)</h2>
                    <p>{formatUsdtAmount(lenderPosition.netDeposited)}</p>
                  </div>
                  <div className={styles.card}>
                    <h2>实时利息 (USDT)</h2>
                    <p>
                      {(() => {
                        const net = parseFloat(
                          formatUsdtAmount(lenderPosition.netDeposited)
                        );
                        const cur =
                          animatedUnderlyingUsdt ??
                          parseFloat(
                            formatUsdtAmount(
                              lenderPosition.underlyingBalance
                            )
                          );
                        if (!Number.isFinite(cur) || !Number.isFinite(net)) {
                          return formatUsdtAmount(lenderPosition.interest);
                        }
                        return (cur - net).toFixed(8);
                      })()}
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </main>

      <footer className={styles.footer}>
        <span>CINA Dex Frontend · BSC 主网 / 测试网</span>
      </footer>
    </div>
  );
};

export default Home;
