import { and, eq } from "drizzle-orm";
import { createWalletClient, erc20Abi, formatEther, formatUnits, getAddress, isAddress, keccak256, parseEther, parseUnits, type Hex, type PublicClient, type Transport } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { decryptWalletKey, encryptWalletKey } from "../crypto";
import { db, tradingAutomations, tradingWallets, type TradingWallet } from "../db";
import { audit } from "./audit";
import { env } from "../env";
import { CHAIN_ID, SWAP_ROUTER, USDG, ethPriceUsd, publicClient, robinhoodChain, rpcTransport } from "./chain";

/**
 * The wallet service. It is the only code that ever holds a signing key in the
 * clear. A key is used for exactly two things:
 *
 * - a withdrawal the signed-in user asked for (`withdraw`), and
 * - live trades, through `tradeSigner`, which can only approve the pinned swap
 *   router and call it with no ETH attached. It cannot send funds anywhere else.
 *
 * Keys never leave this module: they are not returned to the browser, not put
 * in a prompt, not written to a log or the audit trail, and not reachable from
 * any agent tool or from the model.
 */

export class WalletError extends Error {}

export const MAX_WALLETS = 5;
const PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;

type WalletSummary = Pick<TradingWallet, "id" | "name" | "address" | "source">;

async function store(userId: string, name: string, privateKey: Hex, source: "created" | "imported"): Promise<WalletSummary> {
  const owned = await db.select({ address: tradingWallets.address }).from(tradingWallets).where(eq(tradingWallets.userId, userId));
  if (owned.length >= MAX_WALLETS) throw new WalletError(`You can have at most ${MAX_WALLETS} trading wallets.`);
  let address: string;
  try {
    address = privateKeyToAccount(privateKey).address.toLowerCase();
  } catch {
    // Zero, or a number past the curve's order: 64 hex characters that are still not a key.
    throw new WalletError("That is not a valid private key.");
  }
  if (owned.some((wallet) => wallet.address === address)) throw new WalletError("That wallet is already added.");
  const [wallet] = await db
    .insert(tradingWallets)
    .values({ userId, name: name.trim().slice(0, 60) || "Trading wallet", address, keyEnc: encryptWalletKey(privateKey), source })
    .returning({ id: tradingWallets.id, name: tradingWallets.name, address: tradingWallets.address, source: tradingWallets.source });
  await audit({
    userId,
    walletId: wallet!.id,
    type: source === "created" ? "wallet.created" : "wallet.imported",
    actor: "user",
    summary: `${source === "created" ? "Created" : "Imported"} trading wallet ${address}`,
    data: { address },
  });
  return wallet!;
}

/** Makes a new dedicated wallet. The key is generated here and stored encrypted; it is never shown. */
export function createWallet(userId: string, name: string): Promise<WalletSummary> {
  return store(userId, name, generatePrivateKey(), "created");
}

/** Imports a wallet from its private key. Meant for a wallet made only for this agent, never a main wallet. */
export async function importWallet(userId: string, name: string, privateKey: string): Promise<WalletSummary> {
  const key = privateKey.trim().replace(/^(?!0x)/, "0x");
  if (!PRIVATE_KEY.test(key)) throw new WalletError("That is not a private key. It should be 64 hexadecimal characters.");
  return store(userId, name, key as Hex, "imported");
}

export interface WalletBalances {
  ethWei: bigint;
  eth: number;
  usdg: number;
  ethUsd: number;
  totalUsd: number;
  at: number;
}

const balanceCache = new Map<string, WalletBalances>();

/** Live ETH and USDG balances from Robinhood Chain. Null when the chain cannot be read: never a guess. */
export async function walletBalances(address: string, options: { maxAgeMs?: number; client?: PublicClient } = {}): Promise<WalletBalances | null> {
  const cached = balanceCache.get(address);
  if (cached && Date.now() - cached.at < (options.maxAgeMs ?? 15_000)) return cached;
  try {
    const client = options.client ?? publicClient();
    const [ethWei, usdgUnits, ethUsd] = await Promise.all([
      client.getBalance({ address: address as Hex }),
      client.readContract({ address: USDG.address, abi: erc20Abi, functionName: "balanceOf", args: [address as Hex] }),
      ethPriceUsd(),
    ]);
    const eth = Number(formatEther(ethWei));
    const usdg = Number(formatUnits(usdgUnits, USDG.decimals));
    const balances = { ethWei, eth, usdg, ethUsd, totalUsd: eth * ethUsd + usdg, at: Date.now() };
    balanceCache.set(address, balances);
    return balances;
  } catch {
    return null;
  }
}

/** Below this a balance is dust that cannot pay for its own transfer. */
const DUST_USD = 0.05;

/** Whether a wallet can be removed without stranding funds. Unknown balances count as funded. */
export async function holdsFunds(address: string): Promise<boolean> {
  const balances = await walletBalances(address, { maxAgeMs: 0 });
  return balances === null || balances.totalUsd > DUST_USD;
}

export async function removeWallet(userId: string, walletId: string): Promise<void> {
  const [wallet] = await db.select().from(tradingWallets).where(and(eq(tradingWallets.id, walletId), eq(tradingWallets.userId, userId)));
  if (!wallet) throw new WalletError("This wallet no longer exists.");
  const [inUse] = await db.select({ id: tradingAutomations.id }).from(tradingAutomations).where(eq(tradingAutomations.walletId, walletId)).limit(1);
  if (inUse) throw new WalletError("A trading agent uses this wallet. Delete the agent first.");
  if (await holdsFunds(wallet.address)) {
    throw new WalletError("This wallet still holds funds, or its balance could not be checked. Withdraw everything first: removing a wallet destroys its key.");
  }
  await db.delete(tradingWallets).where(eq(tradingWallets.id, walletId));
  await audit({ userId, walletId, type: "wallet.removed", actor: "user", summary: `Removed trading wallet ${wallet.address}`, data: { address: wallet.address } });
}

/** Revokes or restores the wallet's trading authority. While revoked, no agent may trade with it. */
export async function setTradingAuthority(userId: string, walletId: string, allowed: boolean): Promise<void> {
  const [wallet] = await db
    .update(tradingWallets)
    .set({ tradingRevokedAt: allowed ? null : new Date() })
    .where(and(eq(tradingWallets.id, walletId), eq(tradingWallets.userId, userId)))
    .returning({ id: tradingWallets.id, address: tradingWallets.address });
  if (!wallet) throw new WalletError("This wallet no longer exists.");
  await audit({
    userId,
    walletId,
    type: allowed ? "wallet.authority_restored" : "wallet.authority_revoked",
    actor: "user",
    summary: allowed ? `Trading authority restored for ${wallet.address}` : `Trading authority revoked for ${wallet.address}`,
  });
}

export interface WithdrawInput {
  userId: string;
  walletId: string;
  asset: "ETH" | "USDG";
  to: string;
  /** A decimal amount, or "max" for everything that can be sent. */
  amount: string;
}

/**
 * Sends ETH or USDG from a trading wallet to an address the user gives. The
 * transfer is simulated against the chain first and only signed if that passes.
 * `clients` exists so tests can stand in for the chain.
 */
export async function withdraw(input: WithdrawInput, clients: { public: PublicClient; transport: Transport } = { public: publicClient(), transport: rpcTransport() }): Promise<{ hash: string; amount: string }> {
  const [wallet] = await db.select().from(tradingWallets).where(and(eq(tradingWallets.id, input.walletId), eq(tradingWallets.userId, input.userId)));
  if (!wallet) throw new WalletError("This wallet no longer exists.");
  const typed = input.to.trim();
  // A mixed-case address carries a checksum; one that does not match is a typo, not a destination.
  const plain = typed === typed.toLowerCase() || typed === `0x${typed.slice(2).toUpperCase()}`;
  if (!isAddress(typed, { strict: !plain }) || /^0x0{40}$/i.test(typed)) throw new WalletError("Enter a valid 0x address to send to. Check it for typos.");
  const to = getAddress(typed.toLowerCase());
  if (to.toLowerCase() === wallet.address) throw new WalletError("That is this wallet's own address.");
  const max = input.amount.trim().toLowerCase() === "max";
  const decimals = input.asset === "ETH" ? 18 : USDG.decimals;
  // No more decimal places than the asset has, so the amount sent is exactly the amount typed.
  if (!max && !new RegExp(`^\\d{1,12}(\\.\\d{1,${decimals}})?$`).test(input.amount.trim())) {
    throw new WalletError(`Enter an amount such as 0.05 with at most ${decimals} decimal places, or use Max.`);
  }

  const account = privateKeyToAccount(decryptWalletKey(wallet.keyEnc) as Hex);
  if (account.address.toLowerCase() !== wallet.address) throw new WalletError("The stored key does not match this wallet. Nothing was sent.");
  const signer = createWalletClient({ account, chain: robinhoodChain, transport: clients.transport });
  const recipient = to as Hex;

  let hash: Hex;
  let sent: string;
  try {
    // Twice the current gas price as a ceiling; the chain charges the going rate.
    const gasPrice = (await clients.public.getGasPrice()) * 2n;
    if (input.asset === "ETH") {
      const balance = await clients.public.getBalance({ address: account.address });
      const gas = ((await clients.public.estimateGas({ account: account.address, to: recipient, value: 1n })) * 13n) / 10n;
      const fee = gas * gasPrice;
      const value = max ? balance - fee : parseEther(input.amount.trim());
      if (value <= 0n || value + fee > balance) throw new WalletError("There is not enough ETH to send that amount and pay the network fee.");
      // Simulation: the exact transfer is run against the chain without being sent.
      await clients.public.call({ account: account.address, to: recipient, value });
      hash = await signer.sendTransaction({ to: recipient, value, gas, gasPrice });
      sent = formatEther(value);
    } else {
      const balance = await clients.public.readContract({ address: USDG.address, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
      const value = max ? balance : parseUnits(input.amount.trim(), USDG.decimals);
      if (value <= 0n || value > balance) throw new WalletError("The wallet does not hold that much USDG.");
      const call = { account, address: USDG.address, abi: erc20Abi, functionName: "transfer", args: [recipient, value] } as const;
      // Simulated with no gas price attached, for the same reason as an approval: see tradeSigner.
      await clients.public.simulateContract(call);
      const gas = ((await clients.public.estimateContractGas(call)) * 13n) / 10n;
      hash = await signer.writeContract({ address: USDG.address, abi: erc20Abi, functionName: "transfer", args: [recipient, value], gas, gasPrice });
      sent = formatUnits(value, USDG.decimals);
    }
  } catch (error) {
    if (error instanceof WalletError) throw error;
    // The underlying error can quote request details, so only its short form is kept.
    const short = (error as { shortMessage?: string }).shortMessage;
    throw new WalletError(`The withdrawal was not sent: ${(short ?? "the chain rejected or could not simulate the transfer").replace(/\.+$/, "")}.`);
  }

  balanceCache.delete(wallet.address);
  await audit({
    userId: input.userId,
    walletId: wallet.id,
    type: "wallet.withdrawal",
    actor: "user",
    summary: `Withdrew ${sent} ${input.asset} to ${to}`,
    data: { asset: input.asset, to, amount: sent, txHash: hash },
  });
  return { hash, amount: sent };
}

/**
 * What the trading engine is allowed to sign with a wallet. There is no method
 * here that takes a destination: the spender and the call target are always the
 * pinned swap router, and no ETH can be attached.
 */
export interface TradeSigner {
  address: Hex;
  /** Sends an approval of exactly `amount` of `token` to the swap router. Returns the transaction hash. */
  approveExact(token: Hex, amount: bigint): Promise<Hex>;
  /** Signs a call to the swap router. Nothing is sent: the caller records the hash and nonce first, then broadcasts `raw`. */
  signRouterCall(call: { data: Hex; gas: bigint }): Promise<{ raw: Hex; hash: Hex; nonce: number }>;
}

/**
 * Opens a trade signer for a wallet. Refuses unless live trading is switched on
 * for this server and the wallet's trading authority has not been revoked. Both
 * switches are read again before every signature, so one that is flipped in the
 * middle of a trade stops the next signature of that trade.
 */
export async function tradeSigner(walletId: string, clients: { public: PublicClient; transport: Transport } = { public: publicClient(), transport: rpcTransport() }): Promise<TradeSigner> {
  if (!env.liveTrading) throw new WalletError("Live trading is switched off on this server.");
  const [wallet] = await db.select().from(tradingWallets).where(eq(tradingWallets.id, walletId));
  if (!wallet) throw new WalletError("This wallet no longer exists.");
  if (wallet.tradingRevokedAt) throw new WalletError("Trading authority is revoked for this wallet.");
  const account = privateKeyToAccount(decryptWalletKey(wallet.keyEnc) as Hex);
  if (account.address.toLowerCase() !== wallet.address) throw new WalletError("The stored key does not match this wallet. Nothing was signed.");
  const signer = createWalletClient({ account, chain: robinhoodChain, transport: clients.transport });

  async function stillAllowed(): Promise<void> {
    if (!env.liveTrading) throw new WalletError("Live trading is switched off on this server.");
    const [current] = await db.select({ revokedAt: tradingWallets.tradingRevokedAt }).from(tradingWallets).where(eq(tradingWallets.id, walletId));
    if (!current) throw new WalletError("This wallet no longer exists.");
    if (current.revokedAt) throw new WalletError("Trading authority is revoked for this wallet.");
  }

  return {
    address: account.address,
    async approveExact(token, amount) {
      if (amount <= 0n) throw new WalletError("Nothing to approve.");
      await stillAllowed();
      try {
        const call = { account, address: token, abi: erc20Abi, functionName: "approve", args: [SWAP_ROUTER, amount] } as const;
        // Simulated with no gas price attached. Given one, the node assumes the largest gas limit it allows
        // and refuses unless the balance covers that, which is hundreds of times what an approval costs.
        await clients.public.simulateContract(call);
        const [gas, gasPrice] = await Promise.all([clients.public.estimateContractGas(call), clients.public.getGasPrice()]);
        return await signer.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [SWAP_ROUTER, amount], gas: (gas * 13n) / 10n, gasPrice: gasPrice * 2n });
      } catch (error) {
        // The underlying error can quote request details, so only its short form is kept.
        const short = (error as { shortMessage?: string }).shortMessage;
        throw new WalletError(`The approval was not sent: ${(short ?? "the chain rejected or could not simulate it").replace(/\.+$/, "")}.`);
      }
    },
    async signRouterCall({ data, gas }) {
      await stillAllowed();
      const [nonce, gasPrice] = await Promise.all([clients.public.getTransactionCount({ address: account.address, blockTag: "pending" }), clients.public.getGasPrice()]);
      const raw = await account.signTransaction({ to: SWAP_ROUTER, data, value: 0n, gas, gasPrice: gasPrice * 2n, nonce, chainId: CHAIN_ID, type: "legacy" });
      return { raw, hash: keccak256(raw), nonce };
    },
  };
}
