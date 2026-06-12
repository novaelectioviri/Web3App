import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { beginCell, Cell, toNano } from '@ton/core';
import { VotingEscrow } from '../wrappers/VotingEscrow';
import '@ton/test-utils';

describe('VotingEscrow', () => {
  let blockchain: Blockchain;
  let owner: SandboxContract<TreasuryContract>;
  let proposer: SandboxContract<TreasuryContract>;
  let voter1: SandboxContract<TreasuryContract>;
  let voter2: SandboxContract<TreasuryContract>;
  let voter3: SandboxContract<TreasuryContract>;
  let claimer: SandboxContract<TreasuryContract>;
  let target: SandboxContract<TreasuryContract>;
  let escrow: SandboxContract<VotingEscrow>;

  beforeEach(async () => {
    blockchain = await Blockchain.create();
    owner = await blockchain.treasury('owner');
    proposer = await blockchain.treasury('proposer');
    voter1 = await blockchain.treasury('voter1');
    voter2 = await blockchain.treasury('voter2');
    voter3 = await blockchain.treasury('voter3');
    claimer = await blockchain.treasury('claimer');
    target = await blockchain.treasury('target');

    escrow = blockchain.openContract(await VotingEscrow.fromInit(owner.address));

    const deployResult = await escrow.send(
      owner.getSender(),
      { value: toNano('0.2') },
      { $$type: 'Deploy', queryId: 0n },
    );
    expect(deployResult.transactions).toHaveTransaction({
      from: owner.address,
      to: escrow.address,
      deploy: true,
      success: true,
    });
  });

  it('creates proposal with cooldown and proposal fee', async () => {
    const result = await escrow.send(
      proposer.getSender(),
      { value: toNano('2.5') },
      {
        $$type: 'CreateProposal',
        queryId: 1n,
        targetAddress: target.address,
        tonAmount: toNano('0.4'),
        targetPayload: null,
        nftProofCount: 1n,
        jettonProofAmount: toNano('15'),
      },
    );
    expect(result.transactions).toHaveTransaction({
      from: proposer.address,
      to: escrow.address,
      success: true,
    });

    expect(await escrow.getProposalCount()).toBe(1n);
    expect(await escrow.getFeeBalance()).toBe(toNano('2'));

    const cooldown = await escrow.getProposerCooldownUntil(proposer.address);
    expect(cooldown).toBeDefined();
    expect(cooldown! > 0n).toBe(true);
  });

  it('rejects proposal during active cooldown', async () => {
    await escrow.send(
      proposer.getSender(),
      { value: toNano('2.3') },
      {
        $$type: 'CreateProposal',
        queryId: 2n,
        targetAddress: target.address,
        tonAmount: toNano('0.1'),
        targetPayload: null,
        nftProofCount: 2n,
        jettonProofAmount: toNano('7'),
      },
    );

    const second = await escrow.send(
      proposer.getSender(),
      { value: toNano('2.3') },
      {
        $$type: 'CreateProposal',
        queryId: 3n,
        targetAddress: target.address,
        tonAmount: toNano('0.1'),
        targetPayload: null,
        nftProofCount: 1n,
        jettonProofAmount: toNano('6'),
      },
    );

    expect(second.transactions).toHaveTransaction({
      from: proposer.address,
      to: escrow.address,
      success: false,
    });
  });

  it('collects vote fees and prevents duplicate voting', async () => {
    await escrow.send(
      proposer.getSender(),
      { value: toNano('2.5') },
      {
        $$type: 'CreateProposal',
        queryId: 10n,
        targetAddress: target.address,
        tonAmount: toNano('0.2'),
        targetPayload: null,
        nftProofCount: 1n,
        jettonProofAmount: toNano('5'),
      },
    );

    await escrow.send(
      voter1.getSender(),
      { value: toNano('0.8') },
      {
        $$type: 'Vote',
        queryId: 11n,
        proposalId: 1n,
        support: 1n,
        lockedNfts: 1n,
        lockedJettons: toNano('1'),
      },
    );

    const duplicate = await escrow.send(
      voter1.getSender(),
      { value: toNano('0.8') },
      {
        $$type: 'Vote',
        queryId: 12n,
        proposalId: 1n,
        support: 0n,
        lockedNfts: 1n,
        lockedJettons: toNano('1'),
      },
    );
    expect(duplicate.transactions).toHaveTransaction({
      from: voter1.address,
      to: escrow.address,
      success: false,
    });

    expect(await escrow.getProposalVoters(1n)).toBe(1n);
    expect(await escrow.getProposalYesVotes(1n)).toBe(1n);
    expect(await escrow.getFeeBalance()).toBe(toNano('2.5'));
  });

  it('executes proposal after deadline with quorum and consensus', async () => {
    await escrow.send(
      proposer.getSender(),
      { value: toNano('2.5') },
      {
        $$type: 'CreateProposal',
        queryId: 20n,
        targetAddress: target.address,
        tonAmount: toNano('0.3'),
        targetPayload: null,
        nftProofCount: 1n,
        jettonProofAmount: toNano('2'),
      },
    );

    for (const voter of [voter1, voter2, voter3]) {
      await escrow.send(
        voter.getSender(),
        { value: toNano('0.9') },
        {
          $$type: 'Vote',
          queryId: BigInt(voter === voter1 ? 31 : voter === voter2 ? 32 : 33),
          proposalId: 1n,
          support: 1n,
          lockedNfts: 1n,
          lockedJettons: toNano('1'),
        },
      );
    }

    blockchain.now = Number((await escrow.getProposalEndAt(1n))!) + 1;

    const executeResult = await escrow.send(
      owner.getSender(),
      { value: toNano('0.6') },
      {
        $$type: 'ExecuteProposal',
        queryId: 200n,
        proposalId: 1n,
      },
    );

    expect(executeResult.transactions).toHaveTransaction({
      from: escrow.address,
      to: target.address,
      success: true,
    });
    expect(executeResult.transactions).toHaveTransaction({
      from: escrow.address,
      to: proposer.address,
      success: true,
    });
    expect(await escrow.getProposalExecuted(1n)).toBe(1n);
  });

  it('allows claim_for with bounded bonus and marks claimed', async () => {
    await escrow.send(
      proposer.getSender(),
      { value: toNano('2.5') },
      {
        $$type: 'CreateProposal',
        queryId: 300n,
        targetAddress: target.address,
        tonAmount: toNano('0'),
        targetPayload: null,
        nftProofCount: 1n,
        jettonProofAmount: toNano('1'),
      },
    );

    await escrow.send(
      voter1.getSender(),
      { value: toNano('0.9') },
      {
        $$type: 'Vote',
        queryId: 301n,
        proposalId: 1n,
        support: 1n,
        lockedNfts: 2n,
        lockedJettons: toNano('1'),
      },
    );
    await escrow.send(
      voter2.getSender(),
      { value: toNano('0.9') },
      {
        $$type: 'Vote',
        queryId: 302n,
        proposalId: 1n,
        support: 0n,
        lockedNfts: 1n,
        lockedJettons: toNano('2'),
      },
    );

    blockchain.now = Number((await escrow.getProposalEndAt(1n))!) + 1;
    const before = await escrow.getFeeBalance();

    const claimResult = await escrow.send(
      claimer.getSender(),
      { value: toNano('0.4') },
      {
        $$type: 'ClaimFor',
        queryId: 303n,
        proposalId: 1n,
        voter: voter1.address,
      },
    );

    expect(claimResult.transactions).toHaveTransaction({
      from: escrow.address,
      to: voter1.address,
      success: true,
      body: (body) => {
        if (!(body instanceof Cell)) {
          return false;
        }
        const slice = body.beginParse();
        return slice.loadUint(32) === 0x434c4149;
      },
    });

    const after = await escrow.getFeeBalance();
    expect(after < before).toBe(true);
    expect(await escrow.getProposalPendingClaims(1n)).toBe(1n);
    expect(await escrow.getVoteClaimed(1n, voter1.address)).toBe(1n);
  });

  it('rejects proposal when transfer amount is not funded', async () => {
    const result = await escrow.send(
      proposer.getSender(),
      { value: toNano('2.1') },
      {
        $$type: 'CreateProposal',
        queryId: 401n,
        targetAddress: target.address,
        tonAmount: toNano('0.5'),
        targetPayload: null,
        nftProofCount: 1n,
        jettonProofAmount: toNano('4'),
      },
    );

    expect(result.transactions).toHaveTransaction({
      from: proposer.address,
      to: escrow.address,
      success: false,
    });
  });

  it('rejects vote when nft lock is missing', async () => {
    await escrow.send(
      proposer.getSender(),
      { value: toNano('2.3') },
      {
        $$type: 'CreateProposal',
        queryId: 402n,
        targetAddress: target.address,
        tonAmount: toNano('0.1'),
        targetPayload: null,
        nftProofCount: 1n,
        jettonProofAmount: toNano('6'),
      },
    );

    const result = await escrow.send(
      voter1.getSender(),
      { value: toNano('0.9') },
      {
        $$type: 'Vote',
        queryId: 403n,
        proposalId: 1n,
        support: 1n,
        lockedNfts: 0n,
        lockedJettons: toNano('2'),
      },
    );

    expect(result.transactions).toHaveTransaction({
      from: voter1.address,
      to: escrow.address,
      success: false,
    });
  });

  it('supports real on-chain lock via NFT + jetton notifications', async () => {
    await escrow.send(
      owner.getSender(),
      { value: toNano('0.1') },
      {
        $$type: 'ConfigureAssets',
        queryId: 500n,
        jettonWallet: owner.address,
      },
    );

    await escrow.send(
      proposer.getSender(),
      { value: toNano('2.4') },
      {
        $$type: 'CreateProposal',
        queryId: 501n,
        targetAddress: target.address,
        tonAmount: toNano('0.2'),
        targetPayload: null,
        nftProofCount: 1n,
        jettonProofAmount: toNano('5'),
      },
    );

    const voteForwardPayload = beginCell()
      .storeUint(0x564f5445, 32)
      .storeUint(1, 32)
      .storeUint(1, 1)
      .storeAddress(voter1.address)
      .storeUint(1, 16)
      .endCell()
      .beginParse();

    await escrow.send(
      voter1.getSender(),
      { value: toNano('0.2') },
      {
        $$type: 'NftOwnershipAssigned',
        queryId: 502n,
        prevOwner: voter1.address,
        forwardPayload: voteForwardPayload,
      },
    );

    const jettonForwardPayload = beginCell()
      .storeUint(0x564f5445, 32)
      .storeUint(1, 32)
      .storeUint(1, 1)
      .storeAddress(voter1.address)
      .endCell()
      .beginParse();

    const jettonLock = await escrow.send(
      owner.getSender(),
      { value: toNano('0.2') },
      {
        $$type: 'JettonTransferNotification',
        queryId: 503n,
        amount: toNano('2'),
        sender: voter1.address,
        forwardPayload: jettonForwardPayload,
      },
    );
    expect(jettonLock.transactions).toHaveTransaction({
      from: owner.address,
      to: escrow.address,
      success: true,
    });

    expect(await escrow.getProposalVoters(1n)).toBe(1n);
    expect(await escrow.getProposalYesVotes(1n)).toBe(1n);
    expect(await escrow.getFeeBalance()).toBe(toNano('2.5'));
  });

  it('does not count vote after NFT lock only', async () => {
    await escrow.send(
      owner.getSender(),
      { value: toNano('0.1') },
      {
        $$type: 'ConfigureAssets',
        queryId: 505n,
        jettonWallet: owner.address,
      },
    );

    await escrow.send(
      proposer.getSender(),
      { value: toNano('2.4') },
      {
        $$type: 'CreateProposal',
        queryId: 506n,
        targetAddress: target.address,
        tonAmount: toNano('0.2'),
        targetPayload: null,
        nftProofCount: 1n,
        jettonProofAmount: toNano('5'),
      },
    );

    const voteForwardPayload = beginCell()
      .storeUint(0x564f5445, 32)
      .storeUint(1, 32)
      .storeUint(1, 1)
      .storeAddress(voter1.address)
      .storeUint(1, 16)
      .endCell()
      .beginParse();

    const nftOnlyLock = await escrow.send(
      voter1.getSender(),
      { value: toNano('0.2') },
      {
        $$type: 'NftOwnershipAssigned',
        queryId: 507n,
        prevOwner: voter1.address,
        forwardPayload: voteForwardPayload,
      },
    );

    expect(nftOnlyLock.transactions).toHaveTransaction({
      from: voter1.address,
      to: escrow.address,
      success: true,
    });
    expect(await escrow.getProposalVoters(1n)).toBe(0n);
    expect(await escrow.getProposalYesVotes(1n)).toBe(0n);
  });

  it('claim_for returns NFT and jetton transfers in lock mode', async () => {
    await escrow.send(
      owner.getSender(),
      { value: toNano('0.1') },
      {
        $$type: 'ConfigureAssets',
        queryId: 510n,
        jettonWallet: owner.address,
      },
    );

    await escrow.send(
      proposer.getSender(),
      { value: toNano('2.3') },
      {
        $$type: 'CreateProposal',
        queryId: 511n,
        targetAddress: target.address,
        tonAmount: toNano('0.1'),
        targetPayload: null,
        nftProofCount: 1n,
        jettonProofAmount: toNano('3'),
      },
    );

    const voteForwardPayload = beginCell()
      .storeUint(0x564f5445, 32)
      .storeUint(1, 32)
      .storeUint(1, 1)
      .storeAddress(voter1.address)
      .storeUint(1, 16)
      .endCell()
      .beginParse();

    await escrow.send(
      voter1.getSender(),
      { value: toNano('0.2') },
      {
        $$type: 'NftOwnershipAssigned',
        queryId: 512n,
        prevOwner: voter1.address,
        forwardPayload: voteForwardPayload,
      },
    );

    const jettonForwardPayload = beginCell()
      .storeUint(0x564f5445, 32)
      .storeUint(1, 32)
      .storeUint(1, 1)
      .storeAddress(voter1.address)
      .endCell()
      .beginParse();

    await escrow.send(
      owner.getSender(),
      { value: toNano('0.2') },
      {
        $$type: 'JettonTransferNotification',
        queryId: 513n,
        amount: toNano('1'),
        sender: voter1.address,
        forwardPayload: jettonForwardPayload,
      },
    );

    blockchain.now = Number((await escrow.getProposalEndAt(1n))!) + 1;

    const claimResult = await escrow.send(
      claimer.getSender(),
      { value: toNano('0.5') },
      {
        $$type: 'ClaimFor',
        queryId: 514n,
        proposalId: 1n,
        voter: voter1.address,
      },
    );

    expect(claimResult.transactions).toHaveTransaction({
      from: escrow.address,
      to: voter1.address,
      success: true,
    });
    expect(claimResult.transactions).toHaveTransaction({
      from: escrow.address,
      to: owner.address,
      success: true,
    });
  });
});
