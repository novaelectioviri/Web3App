import {
  ESCROW_ADDRESS,
  JETTON_MASTER_ADDRESS,
  NFT_COLLECTION_ADDRESS,
  TONAPI_BASE_URL,
} from './constants.js';

const CACHE_TTL_MS = 30_000;
const cache = new Map();
const FETCH_TIMEOUT_MS = 8_000;

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
  if (!holderAddress) {
    return { nftCount: 0, jettonBalance: 0 };
  }

  return withCache(`power:${holderAddress}`, async () => {
    const safeHolder = encodeURIComponent(holderAddress);
    const nftUrl = `${TONAPI_BASE_URL}/accounts/${safeHolder}/nfts?limit=200`;
    const jettonUrl = `${TONAPI_BASE_URL}/accounts/${safeHolder}/jettons`;

    let nftCount = 0;
    let jettonBalance = 0;

    try {
      const nftResp = await fetchWithTimeout(nftUrl);
      if (nftResp.ok) {
        const nftJson = await nftResp.json();
        const items = Array.isArray(nftJson.nft_items) ? nftJson.nft_items : [];
        nftCount = items.filter((item) => {
          const collectionAddress = item.collection?.address;
          return (
            NFT_COLLECTION_ADDRESS &&
            typeof collectionAddress === 'string' &&
            collectionAddress.toLowerCase() === NFT_COLLECTION_ADDRESS.toLowerCase()
          );
        }).length;
      }
    } catch {
      nftCount = 0;
    }

    try {
      const jettonResp = await fetchWithTimeout(jettonUrl);
      if (jettonResp.ok) {
        const jettonJson = await jettonResp.json();
        const balances = Array.isArray(jettonJson.balances)
          ? jettonJson.balances
          : [];
        const match = balances.find((item) => {
          const addr = item.jetton?.address ?? item.jetton?.master?.address;
          return (
            JETTON_MASTER_ADDRESS &&
            typeof addr === 'string' &&
            addr.toLowerCase() === JETTON_MASTER_ADDRESS.toLowerCase()
          );
        });

        if (match) {
          const raw = Number(match.balance ?? 0);
          const decimals = Number(match.jetton?.decimals ?? 9);
          jettonBalance = raw / 10 ** decimals;
        }
      }
    } catch {
      jettonBalance = 0;
    }

    return { nftCount, jettonBalance };
  });
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
