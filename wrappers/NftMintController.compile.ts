import { CompilerConfig } from '@ton/blueprint';

export const compile: CompilerConfig = {
    lang: 'tact',
    target: 'contracts/nft_mint_controller.tact',
    options: {
        debug: true,
    },
};
