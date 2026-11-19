/**
 * Tests for the real Soroban governance write paths.
 *
 * `executeProposal` and `createProposal` build and submit real
 * `invokeContractFunction` transactions: the wallet signing callback is wired
 * through, the real submitted hash is returned, no in-memory mock state is
 * mutated, and created proposals are confirmed via the `getProposals()` read
 * path. Only the network boundary is stubbed — transactions are built,
 * serialised and parsed with the real Stellar SDK.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rpc } from '@stellar/stellar-sdk';

import { createProposal, executeProposal, MOCK_PROPOSALS } from '../governance';
import {
  decodeGovernanceInvoke,
  echoSignTx,
  firstSimulatedTransaction,
  GOV_SIGNER,
  GOV_TX_HASH,
  makeProposalNative,
  mockGovernanceWriteRpc,
  restoreGovernanceWriteRpc,
  simulationWithProposalId,
  simulationWithProposals,
  type GovernanceWriteMocks,
} from './governance-write-test-utils';

let mocks: GovernanceWriteMocks;

beforeEach(() => {
  echoSignTx.mockClear();
  mocks = mockGovernanceWriteRpc();
});

afterEach(() => {
  restoreGovernanceWriteRpc(mocks);
  vi.restoreAllMocks();
});

describe('governance write paths — executeProposal', () => {
  it('builds a real execute_proposal invoke, wires signTx and returns the submitted hash', async () => {
    mocks.simulateTransaction.mockResolvedValueOnce(simulationWithProposalId(6));

    const tallyBefore = MOCK_PROPOSALS.map((p) => p.status);
    const hash = await executeProposal(6, GOV_SIGNER, echoSignTx);

    expect(hash).toBe(GOV_TX_HASH);
    expect(echoSignTx).toHaveBeenCalledTimes(1);
    expect(echoSignTx.mock.calls[0][0]).toEqual(expect.any(String));

    const invoke = decodeGovernanceInvoke(firstSimulatedTransaction(mocks));
    expect(invoke.functionName).toBe('execute_proposal');
    expect(invoke.args).toEqual([BigInt(6), GOV_SIGNER]);

    // No in-memory mutation of the mock proposals.
    expect(MOCK_PROPOSALS.map((p) => p.status)).toEqual(tallyBefore);
  });

  it('does not fabricate a hash when the simulation fails', async () => {
    mocks.simulateTransaction.mockResolvedValueOnce({ error: 'execution failed' });

    await expect(executeProposal(6, GOV_SIGNER, echoSignTx)).rejects.toThrow(
      /Simulation failed: execution failed/
    );
    expect(echoSignTx).not.toHaveBeenCalled();
  });

  it('throws when the transaction submission is rejected', async () => {
    mocks.simulateTransaction.mockResolvedValueOnce(simulationWithProposalId(6));
    mocks.sendTransaction.mockResolvedValueOnce({ status: 'REJECTED', hash: GOV_TX_HASH });

    await expect(executeProposal(6, GOV_SIGNER, echoSignTx)).rejects.toThrow(
      /Transaction submission failed with status REJECTED/
    );
  });

  it('throws when the submitted transaction does not succeed', async () => {
    mocks.simulateTransaction.mockResolvedValueOnce(simulationWithProposalId(6));
    mocks.pollTransaction.mockResolvedValueOnce({ status: 'FAILED' });

    await expect(executeProposal(6, GOV_SIGNER, echoSignTx)).rejects.toThrow(
      /Transaction failed with status FAILED/
    );
  });

  it('rejects an empty signer address instead of fabricating a hash', async () => {
    await expect(executeProposal(6, '', echoSignTx)).rejects.toThrow();
    expect(mocks.getAccount).not.toHaveBeenCalled();
  });
});

describe('governance write paths — createProposal', () => {
  function mockCreateRoundTrip(overrides: Record<string, unknown> = {}) {
    const proposal = makeProposalNative(overrides);
    mocks.simulateTransaction
      .mockResolvedValueOnce(simulationWithProposalId(101))
      .mockResolvedValueOnce(simulationWithProposals([proposal]));
    return proposal;
  }

  it('builds a real create_proposal invoke, wires signTx and returns the real hash + read-back id', async () => {
    mockCreateRoundTrip();
    const proposalsBefore = MOCK_PROPOSALS.length;

    const result = await createProposal(
      {
        formType: 'FeeRate',
        title: 'Real transaction proposal',
        description: 'Created via a real Soroban transaction',
        newValueBps: 30,
      },
      GOV_SIGNER,
      echoSignTx
    );

    expect(result).toEqual({ txHash: GOV_TX_HASH, proposalId: 101 });
    expect(echoSignTx).toHaveBeenCalledTimes(1);

    const invoke = decodeGovernanceInvoke(firstSimulatedTransaction(mocks));
    expect(invoke.functionName).toBe('create_proposal');
    expect(invoke.args[0]).toBe(GOV_SIGNER);
    expect(invoke.args[1]).toBe('Real transaction proposal');
    expect(invoke.args[2]).toBe('Created via a real Soroban transaction');
    expect(invoke.args[3]).toBe('ParameterUpdate');

    // No in-memory mutation of the mock proposals.
    expect(MOCK_PROPOSALS).toHaveLength(proposalsBefore);
  });

  it.each([
    [
      'FeeRate',
      { formType: 'FeeRate' as const, newValueBps: 20 },
      { parameter: 'fee_rate_bps', valueBps: 20 },
    ],
    [
      'MaxDiscountRate',
      { formType: 'MaxDiscountRate' as const, newValueBps: 350 },
      { parameter: 'max_discount_rate_bps', valueBps: 350 },
    ],
    [
      'AddToken',
      {
        formType: 'AddToken' as const,
        tokenAddress: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      },
      {
        parameter: 'accepted_tokens',
        add: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      },
    ],
    [
      'RemoveToken',
      {
        formType: 'RemoveToken' as const,
        removeTokenAddress: 'CDTKPWPLOURQA2SGTKTUQOWRCBZEORB4BWBOMJ3D3ZTQQSGE5F6JBQLV',
      },
      {
        parameter: 'accepted_tokens',
        remove: 'CDTKPWPLOURQA2SGTKTUQOWRCBZEORB4BWBOMJ3D3ZTQQSGE5F6JBQLV',
      },
    ],
  ])('encodes the %s action in the create_proposal arguments', async (_label, extra, expected) => {
    mockCreateRoundTrip();
    await createProposal(
      {
        title: 'Action encoding',
        description: 'Verify the submitted action',
        ...extra,
      },
      GOV_SIGNER,
      echoSignTx
    );

    const invoke = decodeGovernanceInvoke(firstSimulatedTransaction(mocks));
    expect(JSON.parse(invoke.args[4] as string)).toEqual(expected);
  });

  it('throws when the created proposal cannot be confirmed via getProposals', async () => {
    mocks.simulateTransaction
      .mockResolvedValueOnce(simulationWithProposalId(202))
      .mockResolvedValueOnce(simulationWithProposals([]));

    await expect(
      createProposal(
        {
          formType: 'FeeRate',
          title: 'Unconfirmed proposal',
          description: 'Not visible on the read path',
          newValueBps: 10,
        },
        GOV_SIGNER,
        echoSignTx
      )
    ).rejects.toThrow('Created proposal could not be confirmed via getProposals.');
  });

  it('throws on simulation failure without invoking the wallet callback', async () => {
    mocks.simulateTransaction.mockResolvedValueOnce({ error: 'invalid payload' });

    await expect(
      createProposal(
        {
          formType: 'FeeRate',
          title: 'Invalid',
          description: 'Simulation fails',
          newValueBps: 10,
        },
        GOV_SIGNER,
        echoSignTx
      )
    ).rejects.toThrow(/Simulation failed: invalid payload/);
    expect(echoSignTx).not.toHaveBeenCalled();
  });
});
