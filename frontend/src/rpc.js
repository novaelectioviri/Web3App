import {
  ESCROW_ADDRESS,
  JETTON_MASTER_ADDRESS,
  NFT_COLLECTION_ADDRESS,
  TONAPI_BASE_URL,
} from './constants.js';

const CACHE_TTL_MS = 30_000;
const cache = new Map();
const FETCH_TIMEOUT_MS = 8_000;

function normalizeDecimals(value) {
  const decimals = Number(value);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30) {
    return 9;
  }
  return decimals;
}

function parseBigIntSafe(value) {
  try {
    return BigInt(String(value));
  } catch {
    return 0n;
  }
}

function rawToDisplayAmount(rawAmount, decimals) {
  const safeDecimals = normalizeDecimals(decimals);
  const raw = parseBigIntSafe(rawAmount);
  if (raw <= 0n) {
    return 0;
  }
  const divider = 10n ** BigInt(safeDecimals);
  const integerPart = raw / divider;
  const fractionPart = raw % divider;
  const amount =
    Number(integerPart) + Number(fractionPart) / 10 ** safeDecimals;
  return Number.isFinite(amount) ? amount : 0;
}

function firstAddress(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return '';
}

function isTargetNft(item) {
  const collectionAddress = item?.collection?.address;
  return (
    NFT_COLLECTION_ADDRESS &&
    typeof collectionAddress === 'string' &&
    collectionAddress.toLowerCase() === NFT_COLLECTION_ADDRESS.toLowerCase()
  );
}

function isTargetJetton(item) {
  const addr = item?.jetton?.address ?? item?.jetton?.master?.address;
  return (
    JETTON_MASTER_ADDRESS &&
    typeof addr === 'string' &&
    addr.toLowerCase() === JETTON_MASTER_ADDRESS.toLowerCase()
  );
}

/**
 * @param {string} holderAddress
 * @returns {Promise<{
 *   nftCount: number;
 *   nftAddress: string;
 *   jettonBalance: number;
 *   jettonWalletAddress: string;
 *   jettonDecimals: number;
 *   jettonRawBalance: string;
 *   suggestedJettonLockRaw: string;
 *   suggestedJettonLockAmount: number;
 * }>}
 */
export async function readVotingLockAssets(holderAddress) {
  if (!holderAddress) {
    return {
      nftCount: 0,
      nftAddress: '',
      jettonBalance: 0,
      jettonWalletAddress: '',
      jettonDecimals: 9,
      jettonRawBalance: '0',
      suggestedJettonLockRaw: '0',
      suggestedJettonLockAmount: 0,
    };
  }

  return withCache(`lock-assets:${holderAddress}`, async () => {
    const safeHolder = encodeURIComponent(holderAddress);
    const nftUrl = `${TONAPI_BASE_URL}/accounts/${safeHolder}/nfts?limit=200`;
    const jettonUrl = `${TONAPI_BASE_URL}/accounts/${safeHolder}/jettons`;

    let nftCount = 0;
    let nftAddress = '';
    let jettonBalance = 0;
    let jettonWalletAddress = '';
    let jettonDecimals = 9;
    let jettonRawBalance = '0';
    let suggestedJettonLockRaw = 0n;

    try {
      const nftResp = await fetchWithTimeout(nftUrl);
      if (nftResp.ok) {
        const nftJson = await nftResp.json();
        const items = Array.isArray(nftJson.nft_items) ? nftJson.nft_items : [];
        const matched = items.filter((item) => isTargetNft(item));
        nftCount = matched.length;
        if (nftCount > 0) {
          const first = matched[0];
          nftAddress = firstAddress(
            first?.address,
            first?.nft_item_address,
            first?.item_address,
            first?.id,
          );
        }
      }
    } catch {
      nftCount = 0;
      nftAddress = '';
    }

    try {
      const jettonResp = await fetchWithTimeout(jettonUrl);
      if (jettonResp.ok) {
        const jettonJson = await jettonResp.json();
        const balances = Array.isArray(jettonJson.balances)
          ? jettonJson.balances
          : [];
        const match = balances.find((item) => isTargetJetton(item));
        if (match) {
          jettonDecimals = normalizeDecimals(match.jetton?.decimals ?? 9);
          jettonRawBalance = String(match.balance ?? '0');
          jettonBalance = rawToDisplayAmount(jettonRawBalance, jettonDecimals);
          jettonWalletAddress = firstAddress(
            match.wallet_address?.address,
            match.wallet_address,
            match.wallet?.address,
            match.wallet?.id,
          );
          const raw = parseBigIntSafe(jettonRawBalance);
          if (raw > 0n) {
            const oneJettonRaw = 10n ** BigInt(jettonDecimals);
            suggestedJettonLockRaw = raw >= oneJettonRaw ? oneJettonRaw : raw;
          }
        }
      }
    } catch {
      jettonBalance = 0;
      jettonWalletAddress = '';
      jettonDecimals = 9;
      jettonRawBalance = '0';
      suggestedJettonLockRaw = 0n;
    }

    return {
      nftCount,
      nftAddress,
      jettonBalance,
      jettonWalletAddress,
      jettonDecimals,
      jettonRawBalance,
      suggestedJettonLockRaw: suggestedJettonLockRaw.toString(),
      suggestedJettonLockAmount: rawToDisplayAmount(
        suggestedJettonLockRaw.toString(),
        jettonDecimals,
      ),
    };
  });
}

/**
 * @param {string} url
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => {
    controller.abort();
  }, FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

/**
 * @param {string} key
 * @param {() => Promise<any>} loader
 */
async function withCache(key, loader) {
  const now = Date.now();
  const existing = cache.get(key);
  if (existing && now - existing.timestamp < CACHE_TTL_MS) {
    return existing.value;
  }

  const value = await loader();
  cache.set(key, { timestamp: now, value });
  return value;
}

/**
 * @param {string} address
 * @returns {Promise<boolean>}
 */
async function isActiveAddress(address) {
  if (!address) {
    return false;
  }
  return withCache(`account:${address}`, async () => {
    try {
      const response = await fetchWithTimeout(
        `${TONAPI_BASE_URL}/blockchain/accounts/${encodeURIComponent(address)}`,
      );
      if (!response.ok) {
        return false;
      }
      const json = await response.json();
      const status = json.status ?? json.account?.status ?? '';
      return status === 'active';
    } catch {
      return false;
    }
  });
}

/**
 * @param {string} holderAddress
 * @returns {Promise<{ nftCount: number, jettonBalance: number }>}
 */
export async function readVotingPower(holderAddress) {
  const assets = await readVotingLockAssets(holderAddress);
  return {
    nftCount: assets.nftCount,
    jettonBalance: assets.jettonBalance,
  };
}

/**
 * @returns {Promise<{ escrowActive: boolean, nftCollectionActive: boolean, jettonActive: boolean }>}
 */
export async function readContractReadiness() {
  return withCache('contracts:readiness', async () => {
    const [escrowActive, nftCollectionActive, jettonActive] = await Promise.all([
      isActiveAddress(ESCROW_ADDRESS),
      isActiveAddress(NFT_COLLECTION_ADDRESS),
      isActiveAddress(JETTON_MASTER_ADDRESS),
    ]);

    return {
      escrowActive,
      nftCollectionActive,
      jettonActive,
    };
  });
}

export function invalidateRpcCache() {
  cache.clear();
}
