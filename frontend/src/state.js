import {
  COOL_DOWN_SECONDS,
  GAS_RESERVE,
  MAX_CLAIM_BONUS,
  MIN_QUORUM,
  PROPOSAL_FEE,
  PROPOSAL_REFUND,
  STORAGE_KEY,
  VOTING_DURATION_SECONDS,
  VOTE_FEE,
} from './constants.js';
import { deriveStatus, yesPercent } from './utils.js';

/**
 * @typedef {"Active" | "Consensus" | "Executed" | "Expired" | "Claimable"} ProposalStatus
 */

/**
 * @typedef {{
 * id: number;
 * title: string;
 * description: string;
 * targetAddress: string;
 * amountTon: number;
 * creator: string;
 * createdAt: number;
 * endAt: number;
 * yesVotes: number;
 * noVotes: number;
 * voters: number;
 * executed: boolean;
 * claimedAll: boolean;
 * voterStates: Record<string, { vote: "yes" | "no", claimed: boolean, nftLocked: number, jettonLocked: number }>;
 * }} Proposal
 */

/**
 * @typedef {{
 * feeBalance: number;
 * lastProposalByAddress: Record<string, number>;
 * proposals: Proposal[];
 * }} VotingState
 */

/** @type {VotingState} */
const DEFAULT_STATE = {
  feeBalance: 4.85,
  lastProposalByAddress: {},
  proposals: [
    {
      id: 1,
      title: 'Увеличить резерв газа эскроу',
      description:
        'Скорректировать размер технического резерва для более стабильного исполнения после роста числа claim-транзакций.',
      targetAddress:
        'EQB7A3w-2K5pD4_NzvXujH4zshl4b5eNZgWmrfCmIH5k3A5U',
      amountTon: 2.3,
      creator: 'UQCFf8qhA0kI6ZEw8RZjG7aVY1L_Y7bX4zZ8F3pP2uL6E5Pd',
      createdAt: Math.floor(Date.now() / 1000) - 6000,
      endAt: Math.floor(Date.now() / 1000) + 18000,
      yesVotes: 3,
      noVotes: 1,
      voters: 4,
      executed: false,
      claimedAll: false,
      voterStates: {},
    },
    {
      id: 2,
      title: 'Перевод jetton в treasury',
      description:
        'Перемещение накопленных jetton из escrow на адрес treasury после прохождения консенсуса.',
      targetAddress:
        'UQC8T5GQqNy0lgM7MM8k1PfQ7fO2EWmF9kS8I0tU8uA38D3j',
      amountTon: 0,
      creator: 'EQAI9Yn7V1PxI0M0byAz8D8xA6G2OMjNf6iQC2g4zLALZ8Mx',
      createdAt: Math.floor(Date.now() / 1000) - 40000,
      endAt: Math.floor(Date.now() / 1000) - 900,
      yesVotes: 2,
      noVotes: 2,
      voters: 4,
      executed: false,
      claimedAll: false,
      voterStates: {},
    },
  ],
};

/**
 * @returns {VotingState}
 */
export function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return structuredClone(DEFAULT_STATE);
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(DEFAULT_STATE),
      ...parsed,
      proposals: Array.isArray(parsed.proposals)
        ? parsed.proposals
        : structuredClone(DEFAULT_STATE.proposals),
      lastProposalByAddress:
        parsed.lastProposalByAddress && typeof parsed.lastProposalByAddress === 'object'
          ? parsed.lastProposalByAddress
          : {},
    };
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

/**
 * @param {VotingState} state
 */
export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/**
 * @param {VotingState} state
 * @param {string} address
 */
export function getCooldownInfo(state, address) {
  if (!address) {
    return { secondsLeft: 0, canCreate: true };
  }

  const last = state.lastProposalByAddress[address] ?? 0;
  const secondsLeft = Math.max(
    0,
    last + COOL_DOWN_SECONDS - Math.floor(Date.now() / 1000),
  );
  return {
    secondsLeft,
    canCreate: secondsLeft === 0,
  };
}

/**
 * @param {VotingState} state
 */
export function activeVotesCount(state) {
  return state.proposals.filter((proposal) => {
    const status = deriveStatus(proposal);
    return status === 'Active' || status === 'Consensus';
  }).length;
}

/**
 * @param {VotingState} state
 * @param {{ title: string, description: string, targetAddress: string, amountTon: number, creator: string }} data
 * @returns {Proposal}
 */
export function createProposal(state, data) {
  const now = Math.floor(Date.now() / 1000);
  const proposal = {
    id: Math.max(0, ...state.proposals.map((p) => p.id)) + 1,
    title: data.title,
    description: data.description,
    targetAddress: data.targetAddress,
    amountTon: data.amountTon,
    creator: data.creator,
    createdAt: now,
    endAt: now + VOTING_DURATION_SECONDS,
    yesVotes: 0,
    noVotes: 0,
    voters: 0,
    executed: false,
    claimedAll: false,
    voterStates: {},
  };

  state.proposals.unshift(proposal);
  state.lastProposalByAddress[data.creator] = now;
  state.feeBalance += PROPOSAL_FEE;
  return proposal;
}

/**
 * @param {VotingState} state
 * @param {number} proposalId
 * @param {string} voter
 * @param {"yes" | "no"} vote
 * @param {number} nftLocked
 * @param {number} jettonLocked
 */
export function castVote(state, proposalId, voter, vote, nftLocked, jettonLocked) {
  const proposal = state.proposals.find((item) => item.id === proposalId);
  if (!proposal) {
    throw new Error('Proposal not found');
  }

  if (proposal.voterStates[voter]) {
    throw new Error('Повторное голосование запрещено');
  }

  proposal.voterStates[voter] = {
    vote,
    claimed: false,
    nftLocked,
    jettonLocked,
  };
  proposal.voters += 1;
  if (vote === 'yes') {
    proposal.yesVotes += 1;
  } else {
    proposal.noVotes += 1;
  }
  state.feeBalance += VOTE_FEE;
}

/**
 * @param {VotingState} state
 * @param {number} proposalId
 */
export function executeProposal(state, proposalId) {
  const proposal = state.proposals.find((item) => item.id === proposalId);
  if (!proposal) {
    throw new Error('Proposal not found');
  }

  if (proposal.executed) {
    throw new Error('Уже исполнено');
  }

  const now = Math.floor(Date.now() / 1000);
  if (now < proposal.endAt) {
    throw new Error('Голосование еще активно');
  }

  const total = proposal.yesVotes + proposal.noVotes;
  const passed =
    proposal.voters >= MIN_QUORUM && total > 0 && yesPercent(proposal.yesVotes, proposal.noVotes) >= 75;
  if (!passed) {
    throw new Error('Консенсус не достигнут');
  }

  proposal.executed = true;
  state.feeBalance = Math.max(0, state.feeBalance - GAS_RESERVE - PROPOSAL_REFUND);
}

/**
 * @param {Proposal} proposal
 * @returns {number}
 */
function countPendingClaims(proposal) {
  return Object.values(proposal.voterStates).filter((info) => !info.claimed).length;
}

/**
 * @param {VotingState} state
 * @param {number} proposalId
 * @param {string} caller
 * @param {string} voter
 * @returns {{ bonus: number, releasedNft: number, releasedJetton: number }}
 */
export function claimFor(state, proposalId, caller, voter) {
  const proposal = state.proposals.find((item) => item.id === proposalId);
  if (!proposal) {
    throw new Error('Proposal not found');
  }

  const now = Math.floor(Date.now() / 1000);
  if (now < proposal.endAt) {
    throw new Error('Claim доступен только после дедлайна');
  }

  const voterState = proposal.voterStates[voter];
  if (!voterState) {
    throw new Error('Нет залоченных активов для этого адреса');
  }
  if (voterState.claimed) {
    throw new Error('Активы уже возвращены');
  }

  const pending = countPendingClaims(proposal);
  let bonus = 0;
  const reserveNeed = pending * GAS_RESERVE;
  const distributable = state.feeBalance - reserveNeed;
  if (distributable > 0) {
    bonus = Math.min((distributable * 0.8) / pending, MAX_CLAIM_BONUS);
    bonus = Math.max(0, Number(bonus.toFixed(4)));
    state.feeBalance = Math.max(0, Number((state.feeBalance - bonus).toFixed(4)));
  }

  voterState.claimed = true;
  state.feeBalance = Math.max(0, Number((state.feeBalance - GAS_RESERVE).toFixed(4)));
  proposal.claimedAll = countPendingClaims(proposal) === 0;

  return {
    bonus: caller ? bonus : 0,
    releasedNft: voterState.nftLocked,
    releasedJetton: voterState.jettonLocked,
  };
}
