/**
 * Shared helpers for exercising the real Soroban write paths in
 * `src/utils/governance.ts`. The governance module uses the real Stellar SDK,
 * so these helpers spy on `rpc.Server.prototype` and let the SDK build,
 * serialise and parse genuine transactions while stubbing only the network
 * boundary.
 */
import { vi } from 'vitest';
import {
  Account,
  nativeToScVal,
  rpc,
  scValToNative,
  type xdr,
  type Transaction,
} from '@stellar/stellar-sdk';
import { NETWORK_PASSPHRASE } from '@/constants';

export const GOV_SIGNER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
export const GOV_TX_HASH = '1111111111111111111111111111111111111111111111111111111111111111';

export interface GovernanceWriteMocks {
  getAccount: ReturnType<typeof vi.spyOn>;
  simulateTransaction: ReturnType<typeof vi.spyOn>;
  prepareTransaction: ReturnType<typeof vi.spyOn>;
  sendTransaction: ReturnType<typeof vi.spyOn>;
  pollTransaction: ReturnType<typeof vi.spyOn>;
}

/** Spy on every RPC method used by a governance write transaction. */
export function mockGovernanceWriteRpc(): GovernanceWriteMocks {
  return {
    getAccount: vi
      .spyOn(rpc.Server.prototype, 'getAccount')
      .mockImplementation(async (address: string) => new Account(address, '0') as never),
    simulateTransaction: vi.spyOn(rpc.Server.prototype, 'simulateTransaction'),
    // Echo the unsigned transaction's XDR back so `TransactionBuilder.fromXDR`
    // can parse the "signed" transaction without a real wallet signature.
    prepareTransaction: vi
      .spyOn(rpc.Server.prototype, 'prepareTransaction')
      .mockImplementation(async (tx: Transaction) => ({ toXDR: () => tx.toXDR() }) as never),
    sendTransaction: vi
      .spyOn(rpc.Server.prototype, 'sendTransaction')
      .mockResolvedValue({ status: 'PENDING', hash: GOV_TX_HASH } as never),
    pollTransaction: vi
      .spyOn(rpc.Server.prototype, 'pollTransaction')
      .mockResolvedValue({ status: rpc.Api.GetTransactionStatus.SUCCESS } as never),
  };
}

export function restoreGovernanceWriteRpc(mocks: GovernanceWriteMocks): void {
  mocks.getAccount.mockRestore();
  mocks.simulateTransaction.mockRestore();
  mocks.prepareTransaction.mockRestore();
  mocks.sendTransaction.mockRestore();
  mocks.pollTransaction.mockRestore();
}

/** Successful simulation result carrying a scalar proposal id. */
export function simulationWithProposalId(id: number): Record<string, unknown> {
  return {
    result: { retval: nativeToScVal(id, { type: 'u64' }) },
    events: [],
    minResourceFee: '100',
    transactionData: {},
  };
}

/** Successful `list_proposals` simulation result. */
export function simulationWithProposals(
  proposals: Array<Record<string, unknown>>
): Record<string, unknown> {
  return {
    result: { retval: nativeToScVal(proposals) },
    events: [],
    minResourceFee: '100',
    transactionData: {},
  };
}

/** A native proposal struct suitable for the list_proposals read path. */
export function makeProposalNative(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: 101,
    title: 'Real transaction proposal',
    description: 'Created via a real Soroban transaction',
    type: { ParameterUpdate: [] },
    status: { Active: [] },
    proposer: GOV_SIGNER,
    created_at: 1700000000,
    voting_starts_at: 1700000000,
    voting_ends_at: 1700864000,
    votes_for: 0,
    votes_against: 0,
    quorum_required: 100_000,
    ...overrides,
  };
}

/** Wallet callback that returns the XDR string it is asked to sign. */
export const echoSignTx = vi.fn(async (txXdr: string) => txXdr);

/** The built transaction passed to the first simulation call. */
export function firstSimulatedTransaction(mocks: GovernanceWriteMocks): Transaction {
  return mocks.simulateTransaction.mock.calls[0][0] as Transaction;
}

/** Decode the function name and native arguments of a governance invoke op. */
export function decodeGovernanceInvoke(tx: Transaction): {
  functionName: string;
  args: unknown[];
} {
  const invoke = (tx.operations[0] as { func: { value: () => unknown } }).func.value() as {
    functionName: () => string;
    args: () => xdr.ScVal[];
  };
  return {
    functionName: invoke.functionName(),
    args: Array.from(invoke.args() as xdr.ScVal[]).map((arg) => scValToNative(arg)),
  };
}

/** Network passphrase used by the governance module (re-exported for assertions). */
export { NETWORK_PASSPHRASE };
