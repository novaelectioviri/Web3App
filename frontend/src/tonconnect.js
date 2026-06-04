import { toNano } from '@ton/core';
import { TonConnectUI } from '@tonconnect/ui';
import { ESCROW_ADDRESS, NETWORK, PROPOSAL_FEE, VOTE_FEE } from './constants.js';

const manifestUrl = new URL(
  './tonconnect-manifest.json',
  window.location.href.split('#')[0],
).toString();

/** @type {TonConnectUI | null} */
let tonConnectUI = null;

/**
 * @returns {TonConnectUI}
 */
export function getTonConnectUI() {
  if (!tonConnectUI) {
    tonConnectUI = new TonConnectUI({
      manifestUrl,
      uiPreferences: {
        theme: 'SYSTEM',
      },
    });
  }
  return tonConnectUI;
}

/**
 * @returns {string}
 */
export function connectedAddress() {
  const wallet = getTonConnectUI().wallet;
  return wallet?.account?.address ?? '';
}

/**
 * @param {(address: string) => void} callback
 */
export function onWalletChange(callback) {
  const ui = getTonConnectUI();
  ui.onStatusChange((wallet) => {
    callback(wallet?.account?.address ?? '');
  });
}

function mustHaveEscrowAddress() {
  if (!ESCROW_ADDRESS) {
    throw new Error('VITE_VOTING_ESCROW_ADDRESS не настроен');
  }
}

/**
 * @param {number} value
 * @returns {bigint}
 */
function toQueryId(value) {
  return BigInt(Math.floor(Date.now() / 1000) + value);
}

/**
 * @param {string} value
 * @returns {Promise<import('@ton/core').Address>}
 */
async function parseAnyAddress(value) {
  const { Address } = await import('@ton/core');
  try {
    return Address.parseFriendly(value).address;
  } catch {
    return Address.parse(value);
  }
}

/**
 * @param {{
 * title: string;
 * description: string;
 * targetAddress: string;
 * amountTon: number;
 * nftProofCount: number;
 * jettonProofAmount: number;
 * }} data
 * @returns {Promise<string>}
 */
export async function buildCreateProposalPayload(data) {
  const { beginCell, toNano } = await import('@ton/core');
  const payload = beginCell()
    .storeUint(0x43525052, 32)
    .storeUint(toQueryId(1), 64)
    .storeAddress(await parseAnyAddress(data.targetAddress))
    .storeCoins(toNano(Math.max(0, data.amountTon).toString()))
    .storeBit(0)
    .storeUint(Math.max(1, data.nftProofCount), 16)
    .storeCoins(toNano(Math.max(0, data.jettonProofAmount).toString()))
    .endCell();
  return payload.toBoc().toString('base64');
}

/**
 * @param {{ proposalId: number; support: 0 | 1; lockedNfts: number; lockedJettons: number }} data
 * @returns {Promise<string>}
 */
export async function buildVotePayload(data) {
  const { beginCell, toNano } = await import('@ton/core');
  const payload = beginCell()
    .storeUint(0x564f5445, 32)
    .storeUint(toQueryId(2), 64)
    .storeUint(data.proposalId, 32)
    .storeUint(data.support, 1)
    .storeUint(Math.max(0, data.lockedNfts), 16)
    .storeCoins(toNano(Math.max(0, data.lockedJettons).toString()))
    .endCell();
  return payload.toBoc().toString('base64');
}

/**
 * @param {number} proposalId
 * @returns {Promise<string>}
 */
export async function buildExecutePayload(proposalId) {
  const { beginCell } = await import('@ton/core');
  const payload = beginCell()
    .storeUint(0x45584543, 32)
    .storeUint(toQueryId(3), 64)
    .storeUint(proposalId, 32)
    .endCell();
  return payload.toBoc().toString('base64');
}

/**
 * @param {{ proposalId: number; voter: string }} data
 * @returns {Promise<string>}
 */
export async function buildClaimForPayload(data) {
  const { beginCell } = await import('@ton/core');
  const payload = beginCell()
    .storeUint(0x434c4d46, 32)
    .storeUint(toQueryId(4), 64)
    .storeUint(data.proposalId, 32)
    .storeAddress(await parseAnyAddress(data.voter))
    .endCell();
  return payload.toBoc().toString('base64');
}

/**
 * @param {{ payloadBoc?: string }} [options]
 */
export async function sendCreateProposalTx(options = {}) {
  mustHaveEscrowAddress();
  const ui = getTonConnectUI();
  await ui.sendTransaction({
    validUntil: Math.floor(Date.now() / 1000) + 360,
    network: NETWORK === 'testnet' ? '-3' : undefined,
    messages: [
      {
        address: ESCROW_ADDRESS,
        amount: toNano(PROPOSAL_FEE.toString()).toString(),
        payload: options.payloadBoc,
      },
    ],
  });
}

/**
 * @param {{ payloadBoc?: string }} [options]
 */
export async function sendVoteTx(options = {}) {
  mustHaveEscrowAddress();
  const ui = getTonConnectUI();
  await ui.sendTransaction({
    validUntil: Math.floor(Date.now() / 1000) + 360,
    network: NETWORK === 'testnet' ? '-3' : undefined,
    messages: [
      {
        address: ESCROW_ADDRESS,
        amount: toNano(VOTE_FEE.toString()).toString(),
        payload: options.payloadBoc,
      },
    ],
  });
}

/**
 * @param {{ payloadBoc?: string }} [options]
 */
export async function sendExecuteTx(options = {}) {
  mustHaveEscrowAddress();
  const ui = getTonConnectUI();
  await ui.sendTransaction({
    validUntil: Math.floor(Date.now() / 1000) + 360,
    network: NETWORK === 'testnet' ? '-3' : undefined,
    messages: [
      {
        address: ESCROW_ADDRESS,
        amount: toNano('0.3').toString(),
        payload: options.payloadBoc,
      },
    ],
  });
}

/**
 * @param {string} claimPayloadBoc
 */
export async function sendClaimTx(claimPayloadBoc) {
  mustHaveEscrowAddress();
  const ui = getTonConnectUI();
  await ui.sendTransaction({
    validUntil: Math.floor(Date.now() / 1000) + 360,
    network: NETWORK === 'testnet' ? '-3' : undefined,
    messages: [
      {
        address: ESCROW_ADDRESS,
        amount: toNano('0.2').toString(),
        payload: claimPayloadBoc,
      },
    ],
  });
}
