import {
  ESCROW_ADDRESS,
  JETTON_MASTER_ADDRESS,
  NETWORK,
  LEGACY_VOTE_ENABLED,
  NFT_COLLECTION_ADDRESS,
  PROPOSAL_FEE,
  TONCONNECT_MANIFEST_URL,
  VOTE_FEE,
  VOTE_LOCK,
} from './constants.js';

const DEFAULT_REMOTE_MANIFEST_URL =
  'https://novaelectioviri.github.io/Web3App/tonconnect-manifest.json';

function resolveManifestUrl() {
  if (TONCONNECT_MANIFEST_URL) {
    return TONCONNECT_MANIFEST_URL;
  }

  const protocol = window.location.protocol;
  const isLocalhost =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';
  const isUnsafeProtocol = protocol !== 'https:' && protocol !== 'chrome-extension:';

  if (isLocalhost || isUnsafeProtocol) {
    return DEFAULT_REMOTE_MANIFEST_URL;
  }

  return new URL('./tonconnect-manifest.json', window.location.href.split('#')[0]).toString();
}

const manifestUrl = resolveManifestUrl();

/** @type {any | null} */
let tonConnectUI = null;

/** @type {Promise<any> | null} */
let tonConnectLoadingPromise = null;

/** @type {Promise<typeof import('@ton/core')> | null} */
let tonCorePromise = null;

/** @type {Promise<void> | null} */
let bufferPolyfillPromise = null;

function ensureBufferPolyfill() {
  if (!bufferPolyfillPromise) {
    bufferPolyfillPromise = import('buffer').then(({ Buffer }) => {
      if (!globalThis.Buffer) {
        globalThis.Buffer = Buffer;
      }
    });
  }
  return bufferPolyfillPromise;
}

async function loadTonCore() {
  await ensureBufferPolyfill();
  if (!tonCorePromise) {
    tonCorePromise = import('@ton/core');
  }
  return tonCorePromise;
}

function toNanoSafe(value) {
  return loadTonCore().then(({ toNano }) => toNano(value).toString());
}

function resolveEscrowAddress() {
  if (!ESCROW_ADDRESS) {
    throw new Error('VITE_VOTING_ESCROW_ADDRESS не настроен');
  }
  return ESCROW_ADDRESS;
}

/**
 * @returns {Promise<any>}
 */
export async function getTonConnectUI() {
  if (!tonConnectUI) {
    if (!tonConnectLoadingPromise) {
      tonConnectLoadingPromise = import('@tonconnect/ui').then(({ TonConnectUI }) => {
        tonConnectUI = new TonConnectUI({
          manifestUrl,
          uiPreferences: {
            theme: 'SYSTEM',
          },
        });
        return tonConnectUI;
      });
    }
    await tonConnectLoadingPromise;
  }
  return tonConnectUI;
}

/**
 * @returns {string}
 */
export function connectedAddress() {
  const wallet = tonConnectUI?.wallet;
  return wallet?.account?.address ?? '';
}

/**
 * @param {(address: string) => void} callback
 */
export function onWalletChange(callback) {
  if (!tonConnectUI) {
    return;
  }
  const ui = tonConnectUI;
  ui.onStatusChange((wallet) => {
    callback(wallet?.account?.address ?? '');
  });
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
  const { Address } = await loadTonCore();
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
  const { beginCell, toNano } = await loadTonCore();
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
  const { beginCell, toNano } = await loadTonCore();
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
 * @param {{ proposalId: number; support: 0 | 1; voter: string; lockedNfts: number }} data
 * @returns {Promise<string>}
 */
export async function buildVoteLockNftForwardPayload(data) {
  const { beginCell } = await loadTonCore();
  const payload = beginCell()
    .storeUint(0x564f5445, 32)
    .storeUint(data.proposalId, 32)
    .storeUint(data.support, 1)
    .storeAddress(await parseAnyAddress(data.voter))
    .storeUint(Math.max(1, data.lockedNfts), 16)
    .endCell();
  return payload.toBoc().toString('base64');
}

/**
 * @param {{ proposalId: number; support: 0 | 1; voter: string }} data
 * @returns {Promise<string>}
 */
export async function buildVoteLockJettonForwardPayload(data) {
  const { beginCell } = await loadTonCore();
  const payload = beginCell()
    .storeUint(0x564f5445, 32)
    .storeUint(data.proposalId, 32)
    .storeUint(data.support, 1)
    .storeAddress(await parseAnyAddress(data.voter))
    .endCell();
  return payload.toBoc().toString('base64');
}

/**
 * @param {string} base64
 * @returns {Promise<import('@ton/core').Cell>}
 */
async function parseBoc(base64) {
  const { Cell } = await loadTonCore();
  const cells = Cell.fromBase64(base64);
  if (!cells) {
    throw new Error('Invalid BOC payload');
  }
  return cells;
}

function parsePositiveBigInt(value, label) {
  let parsed;
  try {
    parsed = BigInt(String(value));
  } catch {
    throw new Error(`${label} must be a valid integer`);
  }
  if (parsed <= 0n) {
    throw new Error(`${label} must be positive`);
  }
  return parsed;
}

/**
 * @param {{ voterAddress: string; forwardPayloadBoc: string }} data
 * @returns {Promise<string>}
 */
export async function buildNftTransferPayload(data) {
  const { beginCell } = await loadTonCore();
  const payload = beginCell()
    .storeUint(0x5fcc3d14, 32)
    .storeUint(toQueryId(12), 64)
    .storeAddress(await parseAnyAddress(resolveEscrowAddress()))
    .storeAddress(await parseAnyAddress(data.voterAddress))
    .storeBit(0)
    .storeCoins(0)
    .storeBit(1)
    .storeRef(await parseBoc(data.forwardPayloadBoc))
    .endCell();
  return payload.toBoc().toString('base64');
}

/**
 * @param {{
 * jettonRawAmount: string;
 * voterAddress: string;
 * forwardPayloadBoc: string;
 * }} data
 * @returns {Promise<string>}
 */
export async function buildJettonTransferPayload(data) {
  const { beginCell, toNano } = await loadTonCore();
  const payload = beginCell()
    .storeUint(0x0f8a7ea5, 32)
    .storeUint(toQueryId(13), 64)
    .storeCoins(parsePositiveBigInt(data.jettonRawAmount, 'Jetton amount'))
    .storeAddress(await parseAnyAddress(resolveEscrowAddress()))
    .storeAddress(await parseAnyAddress(data.voterAddress))
    .storeBit(0)
    .storeCoins(toNano('0.05'))
    .storeBit(1)
    .storeRef(await parseBoc(data.forwardPayloadBoc))
    .endCell();
  return payload.toBoc().toString('base64');
}

/**
 * @param {{ nftAddress: string; payloadBoc: string }} data
 */
export async function sendNftLockTx(data) {
  if (!NFT_COLLECTION_ADDRESS) {
    throw new Error('VITE_NFT_COLLECTION_ADDRESS не настроен');
  }
  const ui = await getTonConnectUI();
  const amount = await toNanoSafe('0.2');
  await ui.sendTransaction({
    validUntil: Math.floor(Date.now() / 1000) + 360,
    network: NETWORK === 'testnet' ? '-3' : undefined,
    messages: [
      {
        address: data.nftAddress,
        amount,
        payload: data.payloadBoc,
      },
    ],
  });
}

/**
 * @param {{ jettonWalletAddress: string; payloadBoc: string }} data
 */
export async function sendJettonLockTx(data) {
  if (!JETTON_MASTER_ADDRESS) {
    throw new Error('VITE_JETTON_MASTER_ADDRESS не настроен');
  }
  const ui = await getTonConnectUI();
  const amount = await toNanoSafe('0.25');
  await ui.sendTransaction({
    validUntil: Math.floor(Date.now() / 1000) + 360,
    network: NETWORK === 'testnet' ? '-3' : undefined,
    messages: [
      {
        address: data.jettonWalletAddress,
        amount,
        payload: data.payloadBoc,
      },
    ],
  });
}

/**
 * @returns {boolean}
 */
export function isLegacyVoteEnabled() {
  return LEGACY_VOTE_ENABLED;
}

/**
 * @param {number} proposalId
 * @returns {Promise<string>}
 */
export async function buildExecutePayload(proposalId) {
  const { beginCell } = await loadTonCore();
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
  const { beginCell } = await loadTonCore();
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
  const escrowAddress = resolveEscrowAddress();
  const ui = await getTonConnectUI();
  const tonAmount = Math.max(0, Number(options.tonAmount ?? 0));
  const amount = await toNanoSafe((PROPOSAL_FEE + tonAmount).toString());
  await ui.sendTransaction({
    validUntil: Math.floor(Date.now() / 1000) + 360,
    network: NETWORK === 'testnet' ? '-3' : undefined,
    messages: [
      {
        address: escrowAddress,
        amount,
        payload: options.payloadBoc,
      },
    ],
  });
}

/**
 * @param {{ payloadBoc?: string }} [options]
 */
export async function sendVoteTx(options = {}) {
  const escrowAddress = resolveEscrowAddress();
  const ui = await getTonConnectUI();
  const amount = await toNanoSafe((VOTE_FEE + VOTE_LOCK).toString());
  await ui.sendTransaction({
    validUntil: Math.floor(Date.now() / 1000) + 360,
    network: NETWORK === 'testnet' ? '-3' : undefined,
    messages: [
      {
        address: escrowAddress,
        amount,
        payload: options.payloadBoc,
      },
    ],
  });
}

/**
 * @param {{ payloadBoc?: string }} [options]
 */
export async function sendExecuteTx(options = {}) {
  const escrowAddress = resolveEscrowAddress();
  const ui = await getTonConnectUI();
  const amount = await toNanoSafe('0.3');
  await ui.sendTransaction({
    validUntil: Math.floor(Date.now() / 1000) + 360,
    network: NETWORK === 'testnet' ? '-3' : undefined,
    messages: [
      {
        address: escrowAddress,
        amount,
        payload: options.payloadBoc,
      },
    ],
  });
}

/**
 * @param {string} claimPayloadBoc
 */
export async function sendClaimTx(claimPayloadBoc) {
  const escrowAddress = resolveEscrowAddress();
  const ui = await getTonConnectUI();
  const amount = await toNanoSafe('0.2');
  await ui.sendTransaction({
    validUntil: Math.floor(Date.now() / 1000) + 360,
    network: NETWORK === 'testnet' ? '-3' : undefined,
    messages: [
      {
        address: escrowAddress,
        amount,
        payload: claimPayloadBoc,
      },
    ],
  });
}
