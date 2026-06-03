import { Address } from '@ton/core';
import { TonClient4 } from '@ton/ton';
import { getHttpEndpoint } from '@orbs-network/ton-access';
import {
  ESCROW_ADDRESS,
  JETTON_MASTER_ADDRESS,
  NETWORK,
  NFT_COLLECTION_ADDRESS,
  TONAPI_BASE_URL,
} from './constants.js';

/** @type {Promise<TonClient4> | null} */
let clientPromise = null;

async function getClient() {
  if (!clientPromise) {
    clientPromise = getHttpEndpoint({
      network: NETWORK,
    }).then((endpoint) => new TonClient4({ endpoint }));
  }
  return clientPromise;
}

/**
 * @param {string} address
 * @returns {Promise<boolean>}
 */
async function isActiveAddress(address) {
  if (!address) {
    return false;
  }
  try {
    const client = await getClient();
    const parsed = Address.parseFriendly(address).address;
    const account = await client.getAccountLite(0, parsed);
    return account.account.state.type === 'active';
  } catch {
    return false;
  }
}

/**
 * @param {string} holderAddress
 * @returns {Promise<{ nftCount: number, jettonBalance: number }>}
 */
export async function readVotingPower(holderAddress) {
  if (!holderAddress) {
    return { nftCount: 0, jettonBalance: 0 };
  }

  const safeHolder = encodeURIComponent(holderAddress);
  const nftUrl = `${TONAPI_BASE_URL}/accounts/${safeHolder}/nfts?limit=200`;
  const jettonUrl = `${TONAPI_BASE_URL}/accounts/${safeHolder}/jettons`;

  let nftCount = 0;
  let jettonBalance = 0;

  try {
    const nftResp = await fetch(nftUrl);
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
    const jettonResp = await fetch(jettonUrl);
    if (jettonResp.ok) {
      const jettonJson = await jettonResp.json();
      const balances = Array.isArray(jettonJson.balances) ? jettonJson.balances : [];
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
}

/**
 * @returns {Promise<{ escrowActive: boolean, nftCollectionActive: boolean, jettonActive: boolean }>}
 */
export async function readContractReadiness() {
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
}
