import { CONSENSUS_PERCENT, MIN_QUORUM } from './constants.js';

/**
 * @param {number} seconds
 * @returns {string}
 */
export function formatDuration(seconds) {
  if (seconds <= 0) {
    return '0ч 0м';
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}ч ${minutes}м`;
}

/**
 * @param {number} timestamp
 * @returns {number}
 */
export function secondsUntil(timestamp) {
  return Math.max(0, timestamp - Math.floor(Date.now() / 1000));
}

/**
 * @param {string} address
 * @returns {boolean}
 */
export function validateTonAddress(address) {
  const trimmed = address.trim();
  return /^(EQ|UQ)[A-Za-z0-9_-]{46}$/.test(trimmed);
}

/**
 * @param {number} yes
 * @param {number} no
 * @returns {number}
 */
export function yesPercent(yes, no) {
  const total = yes + no;
  if (total <= 0) {
    return 0;
  }
  return Math.round((yes / total) * 100);
}

/**
 * @param {{ yesVotes: number, noVotes: number, voters: number, endAt: number, executed: boolean, claimedAll: boolean }} proposal
 * @returns {"Active" | "Consensus" | "Executed" | "Expired" | "Claimable"}
 */
export function deriveStatus(proposal) {
  if (proposal.executed) {
    return 'Executed';
  }

  const now = Math.floor(Date.now() / 1000);
  const total = proposal.yesVotes + proposal.noVotes;
  const consensusReached =
    total > 0 &&
    proposal.voters >= MIN_QUORUM &&
    (proposal.yesVotes / total) * 100 >= CONSENSUS_PERCENT;

  if (now < proposal.endAt) {
    return consensusReached ? 'Consensus' : 'Active';
  }

  if (!proposal.claimedAll) {
    return 'Claimable';
  }

  return consensusReached ? 'Consensus' : 'Expired';
}

/**
 * @param {number} n
 * @returns {string}
 */
export function formatTon(n) {
  return `${n.toFixed(2)} TON`;
}

/**
 * @param {number} timestamp
 * @returns {string}
 */
export function formatDateTime(timestamp) {
  return new Date(timestamp * 1000).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
