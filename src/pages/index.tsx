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
import { useState } from 'react';
import {
  buildMockUsdtMintTx,
  getPoolState,
  getUserLoans,
  getUserPosition,
  buildBorrowTx,
  buildDepositTx,
  buildLiquidateTx,
  buildRepayTx,
  type BorrowTx,
  type DepositTx,
  type LiquidateTx,
  type Loan,
  type PoolState,
  type UserPosition,
  type RepayTx,
} from '../lib/api';
import styles from '../styles/Home.module.css';

const SUPPORTED_CHAIN_IDS = [56, 97]; // BSC mainnet and BSC testnet

const Home: NextPage = () => {
  const { address, chainId } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();
  const queryClient = useQueryClient();

  const [mintMockUsdtAmount, setMintMockUsdtAmount] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [borrowAmount, setBorrowAmount] = useState('');
  const [borrowDurationDays, setBorrowDurationDays] = useState('7');
  const [borrowCollateralBnb, setBorrowCollateralBnb] = useState('');
  const [repayLoanId, setRepayLoanId] = useState('');
  const [liquidateLoanId, setLiquidateLoanId] = useState('');

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
      const collateralWei = bnbToWei(borrowCollateralBnb);
      const durationSeconds = Number(borrowDurationDays) * 24 * 60 * 60;
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
      setBorrowCollateralBnb('');
      queryClient.invalidateQueries({ queryKey: ['poolState'] });
      queryClient.invalidateQueries({ queryKey: ['userPosition', address] });
      queryClient.invalidateQueries({ queryKey: ['userLoans', address] });
    },
  });

  const repayMutation = useMutation({
    mutationFn: async () => {
      if (!address) throw new Error('钱包未连接');
      const loanId = Number(repayLoanId);
      if (!Number.isFinite(loanId) || loanId <= 0) {
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
      if (!Number.isFinite(loanId) || loanId <= 0) {
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
                <h3>抵押 BNB 借 USDT</h3>
                <p style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                  输入想借的 USDT 数量、借款天数和抵押的 BNB 数量。
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
                <input
                  type="number"
                  min="0"
                  step="0.000000000000000001"
                  placeholder="抵押 BNB 数量"
                  value={borrowCollateralBnb}
                  onChange={(e) => setBorrowCollateralBnb(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    marginBottom: '0.5rem',
                  }}
                />
                <button
                  type="button"
                  onClick={() => borrowMutation.mutate()}
                  disabled={
                    borrowMutation.isPending ||
                    !borrowAmount.trim() ||
                    !borrowCollateralBnb.trim()
                  }
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
      </main>

      <footer className={styles.footer}>
        <span>CINA Dex Frontend · BSC 主网 / 测试网</span>
      </footer>
    </div>
  );
};

export default Home;
