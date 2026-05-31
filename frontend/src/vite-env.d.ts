/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_VOTING_ESCROW_ADDRESS: string;
  readonly VITE_NFT_MINT_CONTROLLER_ADDRESS: string;
  readonly VITE_NFT_COLLECTION_ADDRESS: string;
  readonly VITE_JETTON_MASTER_ADDRESS: string;
  readonly VITE_TONAPI_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
