export const NETWORK = 'testnet';

export const ROUTES = {
  dashboard: '/',
  create: '/create',
  votes: '/votes',
  claim: '/claim',
};

export const VOTE_FEE = 0.5;
export const VOTE_LOCK = 0.15;
export const PROPOSAL_FEE = 2.0;
export const PROPOSAL_REFUND = 1.0;
export const VOTING_DURATION_SECONDS = 75600;
export const COOL_DOWN_SECONDS = 75600;
export const CONSENSUS_PERCENT = 75;
export const MIN_QUORUM = 3;
export const MAX_CLAIM_BONUS = 0.3;
export const GAS_RESERVE = 0.15;

export const STORAGE_KEY = 'web3app.voting.state.v2';

export const ESCROW_ADDRESS =
  import.meta.env.VITE_VOTING_ESCROW_ADDRESS ?? '';
export const NFT_COLLECTION_ADDRESS =
  import.meta.env.VITE_NFT_COLLECTION_ADDRESS ?? '';
export const JETTON_MASTER_ADDRESS =
  import.meta.env.VITE_JETTON_MASTER_ADDRESS ?? '';
export const TONAPI_BASE_URL =
  import.meta.env.VITE_TONAPI_BASE_URL ?? 'https://tonapi.io/v2';

export const TONCONNECT_MANIFEST_URL =
  import.meta.env.VITE_TONCONNECT_MANIFEST_URL ?? '';

export const LEGACY_VOTE_ENABLED =
  String(import.meta.env.VITE_LEGACY_VOTE_ENABLED ?? '').toLowerCase() ===
  'true';
