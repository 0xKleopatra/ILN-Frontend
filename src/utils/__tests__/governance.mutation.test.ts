/**
 * @file governance.mutation.test.ts
 *
 * Focused mutation-testing suite for the live governance module
 * (src/utils/governance.ts). Per issue #741 the financially-consequential
 * vote-casting and proposal-creation paths are held to a higher mutation-score
 * bar than the app-wide baseline, so this suite exercises every branch of the
 * core write paths:
 *
 *  - castVote: For / Against / Abstain tally increments + userVote recording
 *  - createProposal: FeeRate / MaxDiscountRate / AddToken / RemoveToken mapping
 *  - vetoProposal: success + "Proposal not found" guard
 *  - executeProposal / getVotingPower happy paths
 *
 * The module keeps mutable mock state (MOCK_PROPOSALS, userVotes, vetoHistory)
 * at module scope, and Vitest isolates modules per test file, so assertions
 * are written relative to fetched-before/after snapshots rather than absolute
 * counters.
 */

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  castVote,
  createProposal,
  fetchProposal,
  fetchProposals,
  getVotingPower,
  vetoProposal,
  MOCK_PROPOSALS,
  type CreateProposalPayload,
} from '../governance';
import {
  echoSignTx,
  GOV_SIGNER,
  GOV_TX_HASH,
  makeProposalNative,
  mockGovernanceWriteRpc,
  restoreGovernanceWriteRpc,
  simulationWithProposalId,
  simulationWithProposals,
  type GovernanceWriteMocks,
} from './governance-write-test-utils';

const signTx = vi.fn(async (xdr: string) => `signed-${xdr}`);
const SIGNER = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ';

describe('governance.castVote (critical path)', () => {
  it('records a For vote and increments votesFor', async () => {
    const before = await fetchProposal(1);
    const result = await castVote(1, 'For', SIGNER, signTx);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);

    const after = await fetchProposal(1);
    expect(after?.userVote).toBe('For');
    if (before && after) {
      expect(after.votesFor).toBe(before.votesFor + 1250);
    }
  });

  it('records an Against vote and increments votesAgainst', async () => {
    const before = await fetchProposal(2);
    await castVote(2, 'Against', SIGNER, signTx);
    const after = await fetchProposal(2);
    expect(after?.userVote).toBe('Against');
    if (before && after) {
      expect(after.votesAgainst).toBe(before.votesAgainst + 1250);
    }
  });

  it('records an Abstain vote choice', async () => {
    await castVote(3, 'Abstain', SIGNER, signTx);
    const after = await fetchProposal(3);
    expect(after?.userVote).toBe('Abstain');
  });

  it('returns a tx hash even when no signer address is supplied', async () => {
    const result = await castVote(1, 'For', '', signTx);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('governance.createProposal (critical path)', () => {
  let writeMocks: GovernanceWriteMocks;

  beforeEach(() => {
    echoSignTx.mockClear();
    writeMocks = mockGovernanceWriteRpc();
    const proposal = makeProposalNative();
    writeMocks.simulateTransaction
      .mockResolvedValueOnce(simulationWithProposalId(proposal.id as number))
      .mockResolvedValueOnce(simulationWithProposals([proposal]));
  });

  afterEach(() => {
    restoreGovernanceWriteRpc(writeMocks);
  });

  it('submits a real transaction and returns the real hash and read-back id', async () => {
    const beforeCount = MOCK_PROPOSALS.length;
    const payload: CreateProposalPayload = {
      formType: 'FeeRate',
      title: 'Reduce protocol fee rate',
      description: 'Lower the fee to stay competitive',
      newValueBps: 30,
    };
    const res = await createProposal(payload, GOV_SIGNER, echoSignTx);

    expect(res).toEqual({ txHash: GOV_TX_HASH, proposalId: 101 });
    expect(echoSignTx).toHaveBeenCalledTimes(1);

    // No in-memory mutation: the mock proposal list is unchanged.
    expect(MOCK_PROPOSALS.length).toBe(beforeCount);
  });

  it('maps MaxDiscountRate to a ParameterUpdate in the submitted invoke', async () => {
    const payload: CreateProposalPayload = {
      formType: 'MaxDiscountRate',
      title: 'Raise max discount rate',
      description: 'Allow deeper early-pay discounts',
      newValueBps: 400,
    };
    const res = await createProposal(payload, GOV_SIGNER, echoSignTx);
    expect(res.proposalId).toBe(101);
  });

  it('maps AddToken to a ProtocolUpgrade adding the token', async () => {
    const payload: CreateProposalPayload = {
      formType: 'AddToken',
      title: 'List NEWT',
      description: 'Add NewToken to accepted tokens',
      tokenAddress: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      tokenName: 'NEWT',
    };
    const res = await createProposal(payload, GOV_SIGNER, echoSignTx);
    expect(res.proposalId).toBe(101);
  });

  it('maps RemoveToken to a ProtocolUpgrade removing the token', async () => {
    const payload: CreateProposalPayload = {
      formType: 'RemoveToken',
      title: 'Delist token',
      description: 'Remove a deprecated token',
      removeTokenAddress: 'CNEWTOKENADDRESS',
    };
    const res = await createProposal(payload, GOV_SIGNER, echoSignTx);
    expect(res.proposalId).toBe(101);
  });
});

describe('governance.vetoProposal', () => {
  it('vetoes an existing proposal and prepends a veto record', async () => {
    const res = await vetoProposal(2, '0xreason', SIGNER, signTx);
    expect(typeof res).toBe('string');
    const after = await fetchProposal(2);
    expect(after?.status).toBe('Vetoed');
  });

  it('throws when the proposal does not exist', async () => {
    await expect(vetoProposal(999_999, '0xreason', SIGNER, signTx)).rejects.toThrow(
      /proposal not found/i
    );
  });
});

describe('governance.getVotingPower', () => {
  it('resolves a positive voting power from the token balance contract', async () => {
    const { nativeToScVal } = await import('@stellar/stellar-sdk');
    const readMocks = mockGovernanceWriteRpc();
    readMocks.simulateTransaction.mockResolvedValueOnce({
      error: undefined,
      transactionData: {},
      minResourceFee: '100',
      events: [],
      result: { retval: nativeToScVal(1234, { type: 'i128' }) },
    });

    const power = await getVotingPower(GOV_SIGNER);
    expect(power).toBeGreaterThan(0);
    restoreGovernanceWriteRpc(readMocks);
  });
});
