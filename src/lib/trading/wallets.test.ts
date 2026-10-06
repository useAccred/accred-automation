import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeAbiParameters,
  erc20Abi,
  getAddress,
  keccak256,
  parseEther,
  parseTransaction,
  parseUnits,
  recoverTransactionAddress,
  toHex,
  type Hex,
  type PublicClient,
  type TransactionSerialized,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

/**
 * Wallet service tests.
 *
 * The database half is opt-in: it only runs when TRADING_TEST_DATABASE_URL names
 * the local test database. Nothing here talks to a real chain: withdrawals run
 * against an in-memory fake behind a viem `custom` transport, and global `fetch`
 * is replaced with a stub that throws, so a stray RPC or price request fails
 * loudly instead of leaving the machine.
 */

const url = process.env.TRADING_TEST_DATABASE_URL;
const TEST_DATABASE = "accred_automation_trading";
const TEST_SECRET = "wallets-test-app-secret-0123456789-abcdefghijklmnop";

/** The first well-known Hardhat/Anvil account. Never holds real funds. */
const KNOWN_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const KNOWN_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const GWEI = 1_000_000_000n;
const randomAddress = () => privateKeyToAccount(generatePrivateKey()).address;

describe("wallet key separation", () => {
  let crypto: typeof import("../crypto");

  beforeAll(async () => {
    process.env.APP_SECRET ??= TEST_SECRET;
    crypto = await import("../crypto");
  });

  it("round-trips each kind of secret with its own functions", () => {
    const key = generatePrivateKey();
    expect(crypto.decryptWalletKey(crypto.encryptWalletKey(key))).toBe(key);
    expect(crypto.decrypt(crypto.encrypt("ct_live_test_value"))).toBe("ct_live_test_value");
  });

  it("marks wallet keys with their own prefix and never embeds the plaintext", () => {
    const key = generatePrivateKey();
    const sealed = crypto.encryptWalletKey(key);
    expect(sealed.startsWith("w1.")).toBe(true);
    expect(sealed).not.toContain(key);
    expect(sealed).not.toContain(key.slice(2));
    expect(crypto.encrypt(key).startsWith("v1.")).toBe(true);
    // A fresh IV every time: the same key never encrypts to the same value twice.
    expect(crypto.encryptWalletKey(key)).not.toBe(sealed);
  });

  it("decryptWalletKey cannot read encrypt() output", () => {
    const sealed = crypto.encrypt(generatePrivateKey());
    expect(() => crypto.decryptWalletKey(sealed)).toThrow();
    // Not just a label check: relabelled as a wallet key it still fails authentication.
    expect(() => crypto.decryptWalletKey(sealed.replace(/^v1\./, "w1."))).toThrow();
  });

  it("decrypt() cannot read encryptWalletKey() output", () => {
    const sealed = crypto.encryptWalletKey(generatePrivateKey());
    expect(() => crypto.decrypt(sealed)).toThrow();
    expect(() => crypto.decrypt(sealed.replace(/^w1\./, "v1."))).toThrow();
  });

  it("rejects a tampered wallet key", () => {
    const parts = crypto.encryptWalletKey(generatePrivateKey()).split(".");
    const flipped = Buffer.from(parts[3]!, "base64url");
    flipped[0] = flipped[0]! ^ 0xff;
    parts[3] = flipped.toString("base64url");
    expect(() => crypto.decryptWalletKey(parts.join("."))).toThrow();
  });
});

interface FakeChainOptions {
  eth?: bigint;
  usdg?: bigint;
  gasPrice?: bigint;
  /** Makes the simulated transfer (eth_call) fail. Balance reads still work. */
  failCall?: boolean;
  failEstimateGas?: boolean;
}

describe.skipIf(!url)("wallet service (database)", () => {
  let wallets: typeof import("./wallets");
  let chain: typeof import("./chain");
  let crypto: typeof import("../crypto");
  let dbModule: typeof import("../db");
  let orm: typeof import("drizzle-orm");
  const fetchStub = vi.fn(async (): Promise<Response> => {
    throw new Error("wallets.test: network access is disabled");
  });
  const createdUsers: string[] = [];

  beforeAll(async () => {
    if (new URL(url!).pathname !== `/${TEST_DATABASE}`) throw new Error(`TRADING_TEST_DATABASE_URL must point at the ${TEST_DATABASE} database.`);
    process.env.DATABASE_URL = url;
    process.env.APP_SECRET ??= TEST_SECRET;
    vi.stubGlobal("fetch", fetchStub);
    orm = await import("drizzle-orm");
    crypto = await import("../crypto");
    dbModule = await import("../db");
    chain = await import("./chain");
    wallets = await import("./wallets");
  });

  afterEach(async () => {
    const { db, users } = dbModule;
    // Deleting the user cascades to wallets, agents and audit events.
    for (const id of createdUsers.splice(0)) await db.delete(users).where(orm.eq(users.id, id));
    fetchStub.mockClear();
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    // The exported `db` proxy binds `$client`, which hides its `end`; close the cached pool itself.
    const pool = (globalThis as unknown as { __accredDb?: { $client: { end(): Promise<void> } } }).__accredDb;
    await pool?.$client.end();
  });

  async function makeUser(): Promise<string> {
    const { db, users } = dbModule;
    const apiKey = `ct_live_test_${crypto.randomToken(12)}`;
    const [user] = await db
      .insert(users)
      .values({ keyHash: crypto.sha256(apiKey), keyEnc: crypto.encrypt(apiKey), keyHint: "ct_live_…test" })
      .returning({ id: users.id });
    createdUsers.push(user!.id);
    return user!.id;
  }

  async function walletRow(id: string) {
    const { db, tradingWallets } = dbModule;
    const [row] = await db.select().from(tradingWallets).where(orm.eq(tradingWallets.id, id));
    return row;
  }

  async function auditRows(userId: string) {
    const { db, auditEvents } = dbModule;
    return db.select().from(auditEvents).where(orm.eq(auditEvents.userId, userId));
  }

  /** A user with one imported wallet whose key the test knows. */
  async function fundedWallet() {
    const userId = await makeUser();
    const privateKey = generatePrivateKey();
    const wallet = await wallets.importWallet(userId, "Withdraw test", privateKey);
    return { userId, privateKey, wallet, address: privateKeyToAccount(privateKey).address };
  }

  /** An in-memory stand-in for Robinhood Chain that records every raw transaction it is sent. */
  function fakeChain(holder: string, options: FakeChainOptions = {}) {
    const state = { eth: options.eth ?? 0n, usdg: options.usdg ?? 0n, gasPrice: options.gasPrice ?? GWEI };
    const sent: Hex[] = [];
    const methods: string[] = [];
    const reverted = (message: string) => Object.assign(new Error(message), { code: 3, data: "0x" });
    const same = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();
    const uint = (value: bigint) => encodeAbiParameters([{ type: "uint256" }], [value]);

    const request = async ({ method, params }: { method: string; params?: unknown }): Promise<unknown> => {
      methods.push(method);
      const args = (Array.isArray(params) ? params : []) as unknown[];
      switch (method) {
        case "eth_chainId":
          return "0x1237";
        case "eth_blockNumber":
          return "0x10";
        case "eth_gasPrice":
          return toHex(state.gasPrice);
        case "eth_maxPriorityFeePerGas":
          return "0x0";
        case "eth_feeHistory":
          return { oldestBlock: "0x10", baseFeePerGas: [toHex(state.gasPrice), toHex(state.gasPrice)], gasUsedRatio: [0.5], reward: [["0x0"]] };
        case "eth_getBlockByNumber":
          return {
            number: "0x10",
            hash: `0x${"11".repeat(32)}`,
            parentHash: `0x${"22".repeat(32)}`,
            timestamp: "0x6500000",
            baseFeePerGas: toHex(state.gasPrice),
            gasLimit: "0x1c9c380",
            gasUsed: "0x0",
            difficulty: "0x0",
            totalDifficulty: "0x0",
            size: "0x0",
            nonce: "0x0000000000000000",
            transactions: [],
            uncles: [],
          };
        case "eth_getBalance":
          return toHex(same(args[0], holder) ? state.eth : 0n);
        case "eth_getTransactionCount":
          return "0x7";
        case "eth_getTransactionReceipt":
          return null;
        case "eth_estimateGas": {
          if (options.failEstimateGas) throw reverted("execution reverted");
          const tx = (args[0] ?? {}) as { data?: string };
          return tx.data && tx.data !== "0x" ? toHex(65_000n) : toHex(21_000n);
        }
        case "eth_call": {
          const tx = (args[0] ?? {}) as { to?: string; data?: Hex; from?: string };
          if (same(tx.to, chain.USDG.address) && tx.data) {
            const call = decodeFunctionData({ abi: erc20Abi, data: tx.data });
            if (call.functionName === "balanceOf") return uint(same(call.args[0], holder) ? state.usdg : 0n);
            if (call.functionName === "transfer") {
              if (options.failCall || call.args[1] > state.usdg) throw reverted("execution reverted: ERC20: transfer failed");
              return encodeAbiParameters([{ type: "bool" }], [true]);
            }
            throw reverted(`fake chain: unsupported USDG call ${call.functionName}`);
          }
          if (options.failCall) throw reverted("execution reverted");
          return "0x";
        }
        case "eth_sendRawTransaction":
          sent.push(args[0] as Hex);
          return keccak256(args[0] as Hex);
        default:
          throw Object.assign(new Error(`fake chain: unsupported method ${method}`), { code: -32601 });
      }
    };

    const transport = custom({ request }, { retryCount: 0 });
    const client = createPublicClient({ chain: chain.robinhoodChain, transport }) as PublicClient;
    return { sent, methods, clients: { public: client, transport } };
  }

  async function decodeSent(raw: Hex) {
    const tx = parseTransaction(raw);
    const signer = await recoverTransactionAddress({ serializedTransaction: raw as TransactionSerialized });
    return { tx, signer };
  }

  /** Awaits a call that should fail and returns what it threw, whether it threw or rejected. */
  async function failure(run: () => unknown): Promise<unknown> {
    try {
      await run();
    } catch (error) {
      return error;
    }
    throw new Error("Expected the call to fail, but it succeeded.");
  }

  describe("createWallet", () => {
    it("stores the key encrypted and returns only id, name, address and source", async () => {
      const userId = await makeUser();
      const wallet = await wallets.createWallet(userId, "  My agent wallet  ");

      expect(Object.keys(wallet).sort()).toEqual(["address", "id", "name", "source"]);
      expect(wallet.name).toBe("My agent wallet");
      expect(wallet.source).toBe("created");
      expect(wallet.address).toMatch(/^0x[0-9a-f]{40}$/);

      const row = await walletRow(wallet.id);
      expect(row!.userId).toBe(userId);
      expect(row!.keyEnc.startsWith("w1.")).toBe(true);
      const privateKey = crypto.decryptWalletKey(row!.keyEnc);
      expect(privateKey).toMatch(/^0x[0-9a-f]{64}$/);
      expect(privateKeyToAccount(privateKey as Hex).address.toLowerCase()).toBe(wallet.address);
      expect(row!.keyEnc).not.toContain(privateKey);
      expect(row!.keyEnc).not.toContain(privateKey.slice(2));
      // The general-purpose secret key cannot open it.
      expect(() => crypto.decrypt(row!.keyEnc)).toThrow();

      const events = await auditRows(userId);
      expect(events.map((event) => event.type)).toEqual(["wallet.created"]);
      const logged = JSON.stringify(events);
      expect(logged).not.toContain(privateKey.slice(2));
      expect(logged).not.toContain(row!.keyEnc);
      expect(JSON.stringify(wallet)).not.toContain(privateKey.slice(2));
    });

    it("falls back to a default name and caps the name at 60 characters", async () => {
      const userId = await makeUser();
      expect((await wallets.createWallet(userId, "   ")).name).toBe("Trading wallet");
      expect((await wallets.createWallet(userId, "n".repeat(200))).name).toBe("n".repeat(60));
    });
  });

  describe("importWallet", () => {
    it("derives the address from the key and stores it encrypted", async () => {
      const userId = await makeUser();
      const wallet = await wallets.importWallet(userId, "Known", KNOWN_KEY);

      expect(Object.keys(wallet).sort()).toEqual(["address", "id", "name", "source"]);
      expect(getAddress(wallet.address)).toBe(KNOWN_ADDRESS);
      expect(wallet.address).toBe(KNOWN_ADDRESS.toLowerCase());
      expect(wallet.source).toBe("imported");

      const row = await walletRow(wallet.id);
      expect(row!.keyEnc.startsWith("w1.")).toBe(true);
      expect(row!.keyEnc).not.toContain(KNOWN_KEY.slice(2));
      expect(crypto.decryptWalletKey(row!.keyEnc)).toBe(KNOWN_KEY);

      const events = await auditRows(userId);
      expect(events.map((event) => event.type)).toEqual(["wallet.imported"]);
      expect(JSON.stringify(events)).not.toContain(KNOWN_KEY.slice(2));
      expect(JSON.stringify(events)).not.toContain(row!.keyEnc);
    });

    it("accepts a key without the 0x prefix and with surrounding whitespace", async () => {
      const userId = await makeUser();
      const wallet = await wallets.importWallet(userId, "Known", `  ${KNOWN_KEY.slice(2).toUpperCase()}\n`);
      expect(getAddress(wallet.address)).toBe(KNOWN_ADDRESS);
    });

    it("rejects a wallet the user already added, however the key is written", async () => {
      const userId = await makeUser();
      await wallets.importWallet(userId, "First", KNOWN_KEY);

      for (const again of [KNOWN_KEY, KNOWN_KEY.slice(2), KNOWN_KEY.toUpperCase().replace("0X", "0x")]) {
        const error = await failure(() => wallets.importWallet(userId, "Again", again));
        expect(error).toBeInstanceOf(wallets.WalletError);
        expect((error as Error).message).toMatch(/already added/i);
      }
      const { db, tradingWallets } = dbModule;
      expect(await db.select().from(tradingWallets).where(orm.eq(tradingWallets.userId, userId))).toHaveLength(1);

      // Uniqueness is per user (unique index on user_id + address), not global.
      const other = await makeUser();
      expect(getAddress((await wallets.importWallet(other, "Other user", KNOWN_KEY)).address)).toBe(KNOWN_ADDRESS);
    });

    it("rejects anything that is not a 32-byte hex key", async () => {
      const userId = await makeUser();
      const garbage = ["", "   ", "hello world", "0x", "0x1234", `0x${"a".repeat(63)}`, `0x${"a".repeat(65)}`, `0x${"z".repeat(64)}`, `0x0x${"a".repeat(62)}`, KNOWN_ADDRESS, "twelve word seed phrase is not a private key at all ok fine yes"];
      for (const value of garbage) {
        const error = await failure(() => wallets.importWallet(userId, "Bad", value));
        expect(error, JSON.stringify(value)).toBeInstanceOf(wallets.WalletError);
        // The rejected input is not echoed back.
        if (value.trim().length > 4) expect((error as Error).message).not.toContain(value.trim());
      }
      const { db, tradingWallets } = dbModule;
      expect(await db.select().from(tradingWallets).where(orm.eq(tradingWallets.userId, userId))).toHaveLength(0);
      expect(await auditRows(userId)).toHaveLength(0);
    });

    // 64 hex characters can still fail to be a key: zero, or a number at or past the curve's order.
    it("rejects out-of-range keys with a WalletError", async () => {
      const userId = await makeUser();
      for (const value of [`0x${"0".repeat(64)}`, `0x${"f".repeat(64)}`]) {
        expect(await failure(() => wallets.importWallet(userId, "Bad", value)), value).toBeInstanceOf(wallets.WalletError);
      }
    });

    it("never stores an out-of-range key", async () => {
      const userId = await makeUser();
      for (const value of [`0x${"0".repeat(64)}`, `0x${"f".repeat(64)}`]) await failure(() => wallets.importWallet(userId, "Bad", value));
      const { db, tradingWallets } = dbModule;
      expect(await db.select().from(tradingWallets).where(orm.eq(tradingWallets.userId, userId))).toHaveLength(0);
    });
  });

  describe("MAX_WALLETS", () => {
    it("refuses one more wallet than the limit, created or imported", async () => {
      const userId = await makeUser();
      expect(wallets.MAX_WALLETS).toBe(5);
      for (let index = 0; index < wallets.MAX_WALLETS; index += 1) await wallets.createWallet(userId, `Wallet ${index + 1}`);

      const created = await failure(() => wallets.createWallet(userId, "One too many"));
      expect(created).toBeInstanceOf(wallets.WalletError);
      expect((created as Error).message).toContain(String(wallets.MAX_WALLETS));
      expect(await failure(() => wallets.importWallet(userId, "One too many", generatePrivateKey()))).toBeInstanceOf(wallets.WalletError);

      const { db, tradingWallets } = dbModule;
      expect(await db.select().from(tradingWallets).where(orm.eq(tradingWallets.userId, userId))).toHaveLength(wallets.MAX_WALLETS);

      // The limit is per user.
      const other = await makeUser();
      expect((await wallets.createWallet(other, "Fine")).source).toBe("created");
    });
  });

  describe("withdraw", () => {
    it("sends ETH: signed by the wallet, on chain 4663, to the recipient, for the amount", async () => {
      const { userId, wallet, address } = await fundedWallet();
      const recipient = randomAddress();
      const fake = fakeChain(address, { eth: parseEther("1"), gasPrice: GWEI });

      const result = await wallets.withdraw({ userId, walletId: wallet.id, asset: "ETH", to: recipient, amount: "0.25" }, fake.clients);

      expect(fake.sent).toHaveLength(1);
      const { tx, signer } = await decodeSent(fake.sent[0]!);
      expect(tx.chainId).toBe(4663);
      expect(tx.chainId).toBe(chain.CHAIN_ID);
      expect(tx.to?.toLowerCase()).toBe(recipient.toLowerCase());
      expect(tx.value).toBe(parseEther("0.25"));
      expect(tx.data ?? "0x").toBe("0x");
      expect(tx.nonce).toBe(7);
      expect(signer).toBe(address);
      expect(signer.toLowerCase()).toBe(wallet.address);
      // Fee ceiling: 1.3x the estimate at twice the going gas price, and affordable.
      expect(tx.gas).toBe(27_300n);
      expect(tx.gasPrice).toBe(2n * GWEI);
      expect(result).toEqual({ hash: keccak256(fake.sent[0]!), amount: "0.25" });
      // The transfer was simulated before it was signed and sent.
      expect(fake.methods.indexOf("eth_call")).toBeGreaterThanOrEqual(0);
      expect(fake.methods.indexOf("eth_call")).toBeLessThan(fake.methods.indexOf("eth_sendRawTransaction"));
      expect(fetchStub).not.toHaveBeenCalled();
    });

    it('"max" ETH sends the balance less the fee ceiling', async () => {
      const { userId, wallet, address } = await fundedWallet();
      const balance = parseEther("0.731");
      const fake = fakeChain(address, { eth: balance, gasPrice: 3n * GWEI });

      const result = await wallets.withdraw({ userId, walletId: wallet.id, asset: "ETH", to: randomAddress(), amount: " MAX " }, fake.clients);

      expect(fake.sent).toHaveLength(1);
      const { tx, signer } = await decodeSent(fake.sent[0]!);
      const fee = tx.gas! * tx.gasPrice!;
      expect(fee).toBe(27_300n * 6n * GWEI);
      expect(tx.value).toBe(balance - fee);
      expect(tx.value! + fee).toBeLessThanOrEqual(balance);
      expect(tx.value!).toBeLessThan(balance);
      expect(tx.chainId).toBe(4663);
      expect(signer).toBe(address);
      expect(parseEther(result.amount)).toBe(balance - fee);
    });

    it('"max" ETH refuses when the balance cannot cover the fee', async () => {
      const { userId, wallet, address } = await fundedWallet();
      const fake = fakeChain(address, { eth: 1_000n, gasPrice: GWEI });
      const error = await failure(() => wallets.withdraw({ userId, walletId: wallet.id, asset: "ETH", to: randomAddress(), amount: "max" }, fake.clients));
      expect(error).toBeInstanceOf(wallets.WalletError);
      expect(fake.sent).toHaveLength(0);
    });

    it("sends USDG as an ERC-20 transfer to the USDG contract", async () => {
      const { userId, wallet, address } = await fundedWallet();
      const recipient = randomAddress();
      const fake = fakeChain(address, { eth: parseEther("0.01"), usdg: parseUnits("500", 6) });

      const result = await wallets.withdraw({ userId, walletId: wallet.id, asset: "USDG", to: recipient, amount: "125.5" }, fake.clients);

      expect(fake.sent).toHaveLength(1);
      const { tx, signer } = await decodeSent(fake.sent[0]!);
      expect(tx.chainId).toBe(4663);
      expect(tx.to?.toLowerCase()).toBe(chain.USDG.address);
      expect(tx.value ?? 0n).toBe(0n);
      const call = decodeFunctionData({ abi: erc20Abi, data: tx.data! });
      expect(call.functionName).toBe("transfer");
      expect((call.args![0] as string).toLowerCase()).toBe(recipient.toLowerCase());
      expect(call.args![1]).toBe(125_500_000n);
      expect(tx.gasPrice).toBe(2n * GWEI);
      expect(signer).toBe(address);
      expect(result).toEqual({ hash: keccak256(fake.sent[0]!), amount: "125.5" });
      expect(fake.methods.lastIndexOf("eth_call")).toBeLessThan(fake.methods.indexOf("eth_sendRawTransaction"));
      expect(fetchStub).not.toHaveBeenCalled();
    });

    it('"max" USDG sends the whole token balance', async () => {
      const { userId, wallet, address } = await fundedWallet();
      const recipient = randomAddress();
      const fake = fakeChain(address, { eth: parseEther("0.01"), usdg: 42_123_456n });

      const result = await wallets.withdraw({ userId, walletId: wallet.id, asset: "USDG", to: recipient, amount: "max" }, fake.clients);

      const { tx } = await decodeSent(fake.sent[0]!);
      const call = decodeFunctionData({ abi: erc20Abi, data: tx.data! });
      expect(call.args![1]).toBe(42_123_456n);
      expect(result.amount).toBe("42.123456");
    });

    it("refuses an amount above the balance and sends nothing", async () => {
      const { userId, wallet, address } = await fundedWallet();
      const fake = fakeChain(address, { eth: parseEther("1"), usdg: parseUnits("50", 6) });
      const attempts = [
        { asset: "ETH" as const, amount: "2" },
        // The whole balance leaves nothing for the fee.
        { asset: "ETH" as const, amount: "1" },
        { asset: "USDG" as const, amount: "50.000001" },
        { asset: "USDG" as const, amount: "1000" },
      ];
      for (const attempt of attempts) {
        const error = await failure(() => wallets.withdraw({ userId, walletId: wallet.id, to: randomAddress(), ...attempt }, fake.clients));
        expect(error, JSON.stringify(attempt)).toBeInstanceOf(wallets.WalletError);
      }
      expect(fake.sent).toHaveLength(0);
      expect((await auditRows(userId)).filter((event) => event.type === "wallet.withdrawal")).toHaveLength(0);
    });

    it("refuses a zero amount, including one that rounds to zero", async () => {
      const { userId, wallet, address } = await fundedWallet();
      const fake = fakeChain(address, { eth: parseEther("1"), usdg: parseUnits("50", 6) });
      for (const attempt of [
        { asset: "ETH" as const, amount: "0" },
        { asset: "USDG" as const, amount: "0.0" },
        { asset: "USDG" as const, amount: "0.0000001" },
      ]) {
        const error = await failure(() => wallets.withdraw({ userId, walletId: wallet.id, to: randomAddress(), ...attempt }, fake.clients));
        expect(error, JSON.stringify(attempt)).toBeInstanceOf(wallets.WalletError);
      }
      expect(fake.sent).toHaveLength(0);
    });

    it("refuses the zero address, the wallet's own address and non-addresses before touching the chain", async () => {
      const { userId, wallet, address } = await fundedWallet();
      const fake = fakeChain(address, { eth: parseEther("1"), usdg: parseUnits("50", 6) });
      const targets = [`0x${"0".repeat(40)}`, address, address.toLowerCase(), ` ${address} `, "", "0x1234", "not an address", `${randomAddress()}00`, "vitalik.eth"];
      for (const to of targets) {
        for (const asset of ["ETH", "USDG"] as const) {
          const error = await failure(() => wallets.withdraw({ userId, walletId: wallet.id, asset, to, amount: "0.1" }, fake.clients));
          expect(error, `${asset} to ${JSON.stringify(to)}`).toBeInstanceOf(wallets.WalletError);
        }
      }
      expect(fake.sent).toHaveLength(0);
      expect(fake.methods).toEqual([]);
    });

    it("refuses a malformed amount before touching the chain", async () => {
      const { userId, wallet, address } = await fundedWallet();
      const fake = fakeChain(address, { eth: parseEther("1"), usdg: parseUnits("50", 6) });
      const amounts = ["", "abc", "-1", "+1", "1e3", "0x10", "1.", ".5", "1,5", "1.2.3", "1 2", "all", "NaN", "Infinity", `0.${"1".repeat(19)}`, "1".repeat(13)];
      for (const amount of amounts) {
        for (const asset of ["ETH", "USDG"] as const) {
          const error = await failure(() => wallets.withdraw({ userId, walletId: wallet.id, asset, to: randomAddress(), amount }, fake.clients));
          expect(error, `${asset} ${JSON.stringify(amount)}`).toBeInstanceOf(wallets.WalletError);
        }
      }
      expect(fake.sent).toHaveLength(0);
      expect(fake.methods).toEqual([]);
    });

    it("sends nothing when the simulation fails", async () => {
      const { userId, privateKey, wallet, address } = await fundedWallet();
      const funds = { eth: parseEther("1"), usdg: parseUnits("50", 6) };
      const cases = [
        { asset: "ETH" as const, options: { failCall: true } },
        { asset: "ETH" as const, options: { failEstimateGas: true } },
        { asset: "USDG" as const, options: { failCall: true } },
        { asset: "USDG" as const, options: { failCall: true, failEstimateGas: true } },
      ];
      for (const { asset, options } of cases) {
        const fake = fakeChain(address, { ...funds, ...options });
        const error = await failure(() => wallets.withdraw({ userId, walletId: wallet.id, asset, to: randomAddress(), amount: "0.1" }, fake.clients));
        expect(error, `${asset} ${JSON.stringify(options)}`).toBeInstanceOf(wallets.WalletError);
        expect((error as Error).message).toMatch(/not sent/i);
        expect((error as Error).message).not.toContain(privateKey.slice(2));
        expect(fake.sent, `${asset} ${JSON.stringify(options)}`).toHaveLength(0);
        expect(fake.methods).not.toContain("eth_sendRawTransaction");
      }
      expect((await auditRows(userId)).filter((event) => event.type === "wallet.withdrawal")).toHaveLength(0);
    });

    it("sends nothing when gas for a USDG transfer cannot be estimated", async () => {
      const { userId, wallet, address } = await fundedWallet();
      const fake = fakeChain(address, { eth: parseEther("1"), usdg: parseUnits("50", 6), failEstimateGas: true });
      const error = await failure(() => wallets.withdraw({ userId, walletId: wallet.id, asset: "USDG", to: randomAddress(), amount: "1" }, fake.clients));
      expect(error).toBeInstanceOf(wallets.WalletError);
      expect(fake.sent).toHaveLength(0);
    });

    it("cannot withdraw from a wallet that belongs to another user", async () => {
      const { userId, wallet, address } = await fundedWallet();
      const intruder = await makeUser();
      const fake = fakeChain(address, { eth: parseEther("1"), usdg: parseUnits("50", 6) });

      for (const asset of ["ETH", "USDG"] as const) {
        const error = await failure(() => wallets.withdraw({ userId: intruder, walletId: wallet.id, asset, to: randomAddress(), amount: "0.1" }, fake.clients));
        expect(error).toBeInstanceOf(wallets.WalletError);
      }
      expect(fake.sent).toHaveLength(0);
      expect(fake.methods).toEqual([]);
      expect(await auditRows(intruder)).toHaveLength(0);
      expect((await auditRows(userId)).filter((event) => event.type === "wallet.withdrawal")).toHaveLength(0);

      // An unknown wallet id is refused the same way.
      const missing = await failure(() => wallets.withdraw({ userId, walletId: "00000000-0000-4000-8000-000000000000", asset: "ETH", to: randomAddress(), amount: "0.1" }, fake.clients));
      expect(missing).toBeInstanceOf(wallets.WalletError);
      expect(fake.sent).toHaveLength(0);
    });

    it("refuses to sign when the stored key does not belong to the wallet's address", async () => {
      const { userId, wallet, address } = await fundedWallet();
      const { db, tradingWallets } = dbModule;
      await db.update(tradingWallets).set({ keyEnc: crypto.encryptWalletKey(generatePrivateKey()) }).where(orm.eq(tradingWallets.id, wallet.id));
      const fake = fakeChain(address, { eth: parseEther("1") });
      const error = await failure(() => wallets.withdraw({ userId, walletId: wallet.id, asset: "ETH", to: randomAddress(), amount: "0.1" }, fake.clients));
      expect(error).toBeInstanceOf(wallets.WalletError);
      expect(fake.sent).toHaveLength(0);
      expect(fake.methods).toEqual([]);
    });

    it("records a wallet.withdrawal audit event with the tx hash and no key material", async () => {
      const { userId, privateKey, wallet, address } = await fundedWallet();
      const recipient = randomAddress();
      const fake = fakeChain(address, { eth: parseEther("1"), usdg: parseUnits("50", 6) });

      const eth = await wallets.withdraw({ userId, walletId: wallet.id, asset: "ETH", to: recipient, amount: "0.5" }, fake.clients);
      const usdg = await wallets.withdraw({ userId, walletId: wallet.id, asset: "USDG", to: recipient, amount: "12.5" }, fake.clients);
      expect(fake.sent).toHaveLength(2);

      const row = await walletRow(wallet.id);
      const events = await auditRows(userId);
      const withdrawals = events.filter((event) => event.type === "wallet.withdrawal");
      expect(withdrawals).toHaveLength(2);
      for (const event of withdrawals) {
        expect(event.walletId).toBe(wallet.id);
        expect(event.actor).toBe("user");
        expect(event.summary).toContain(recipient);
      }
      const byAsset = (asset: string) => withdrawals.find((event) => event.data?.asset === asset)!;
      expect(byAsset("ETH").data).toEqual({ asset: "ETH", to: recipient, amount: "0.5", txHash: eth.hash });
      expect(byAsset("USDG").data).toEqual({ asset: "USDG", to: recipient, amount: "12.5", txHash: usdg.hash });
      expect(eth.hash).toBe(keccak256(fake.sent[0]!));
      expect(usdg.hash).toBe(keccak256(fake.sent[1]!));

      // Nothing in the whole trail for this user, or in what was returned, carries the key.
      const haystack = JSON.stringify([events, eth, usdg]).toLowerCase();
      expect(haystack).not.toContain(privateKey.slice(2).toLowerCase());
      expect(haystack).not.toContain(row!.keyEnc.toLowerCase());
      expect(haystack).not.toContain("w1.");
      for (const event of events) expect(Object.keys(event.data ?? {}).join(",")).not.toMatch(/key|secret|private/i);
    });

    // The recipient check itself is lenient (`strict: false`), but viem refuses a
    // mixed-case address whose EIP-55 checksum is wrong before anything is signed.
    it("refuses a mixed-case recipient whose checksum is wrong (a likely typo)", async () => {
      const { userId, wallet, address } = await fundedWallet();
      const good = randomAddress();
      const body = good.slice(2);
      const index = [...body].findIndex((character) => /[a-fA-F]/.test(character));
      const swapped = body[index] === body[index]!.toUpperCase() ? body[index]!.toLowerCase() : body[index]!.toUpperCase();
      const badChecksum = `0x${body.slice(0, index)}${swapped}${body.slice(index + 1)}`;
      expect(badChecksum).not.toBe(good);
      expect(/[a-f]/.test(badChecksum.slice(2)) && /[A-F]/.test(badChecksum.slice(2))).toBe(true);

      const fake = fakeChain(address, { eth: parseEther("1"), usdg: parseUnits("50", 6) });
      for (const asset of ["ETH", "USDG"] as const) {
        const error = await failure(() => wallets.withdraw({ userId, walletId: wallet.id, asset, to: badChecksum, amount: "0.1" }, fake.clients));
        expect(error, asset).toBeInstanceOf(wallets.WalletError);
      }
      expect(fake.sent).toHaveLength(0);

      // The same address in a single case carries no checksum and is accepted.
      await wallets.withdraw({ userId, walletId: wallet.id, asset: "ETH", to: good.toLowerCase(), amount: "0.1" }, fake.clients);
      expect(fake.sent).toHaveLength(1);
      expect(parseTransaction(fake.sent[0]!).to?.toLowerCase()).toBe(good.toLowerCase());
    });

    // USDG has 6 decimals. Extra digits would be rounded, sending slightly more than was typed.
    it("refuses a USDG amount with more decimals than USDG has, instead of rounding it", async () => {
      const { userId, wallet, address } = await fundedWallet();
      const fake = fakeChain(address, { eth: parseEther("0.01"), usdg: parseUnits("50", 6) });
      const attempt = await failure(() => wallets.withdraw({ userId, walletId: wallet.id, asset: "USDG", to: randomAddress(), amount: "1.0000005" }, fake.clients));
      expect(attempt).toBeInstanceOf(wallets.WalletError);
      expect(fake.sent).toHaveLength(0);
      // Exactly six decimals is sent as typed.
      const result = await wallets.withdraw({ userId, walletId: wallet.id, asset: "USDG", to: randomAddress(), amount: "1.000001" }, fake.clients);
      const call = decodeFunctionData({ abi: erc20Abi, data: parseTransaction(fake.sent[0]!).data! });
      expect(call.args![1]).toBe(1_000_001n);
      expect(result.amount).toBe("1.000001");
    });
  });

  describe("removeWallet", () => {
    it("refuses while a trading agent references the wallet", async () => {
      const userId = await makeUser();
      const wallet = await wallets.createWallet(userId, "In use");
      const { db, tradingAutomations } = dbModule;
      await db.insert(tradingAutomations).values({ userId, walletId: wallet.id, name: "Agent", maxPerRunMicro: 1_000_000n, maxPerMonthMicro: 10_000_000n });

      const error = await failure(() => wallets.removeWallet(userId, wallet.id));
      expect(error).toBeInstanceOf(wallets.WalletError);
      expect((error as Error).message).toMatch(/agent/i);
      expect(await walletRow(wallet.id)).toBeDefined();
      expect((await auditRows(userId)).map((event) => event.type)).not.toContain("wallet.removed");
      // The refusal comes before any balance check, so the chain was never asked.
      expect(fetchStub).not.toHaveBeenCalled();
    });

    it("refuses a wallet that belongs to another user", async () => {
      const owner = await makeUser();
      const wallet = await wallets.createWallet(owner, "Mine");
      const intruder = await makeUser();
      expect(await failure(() => wallets.removeWallet(intruder, wallet.id))).toBeInstanceOf(wallets.WalletError);
      expect(await walletRow(wallet.id)).toBeDefined();
      expect(fetchStub).not.toHaveBeenCalled();
    });

    // removeWallet -> holdsFunds -> walletBalances() takes no injected client, so
    // the funded/empty branches cannot be exercised against the fake chain. What
    // can be shown without a network is that it fails closed: with every request
    // refused (fetch is stubbed), the balance is unknown and the wallet is kept.
    it("keeps the wallet when its balance cannot be checked", async () => {
      const userId = await makeUser();
      const wallet = await wallets.createWallet(userId, "Unknown balance");

      const error = await failure(() => wallets.removeWallet(userId, wallet.id));
      expect(error).toBeInstanceOf(wallets.WalletError);
      expect((error as Error).message).toMatch(/could not be checked/i);
      expect(fetchStub).toHaveBeenCalled();
      expect(await walletRow(wallet.id)).toBeDefined();
      expect((await auditRows(userId)).map((event) => event.type)).not.toContain("wallet.removed");
    }, 60_000);
  });
});
