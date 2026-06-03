import { CompilerConfig } from '@ton/blueprint';

export const compile: CompilerConfig = {
  lang: 'tact',
  target: 'contracts/voting_escrow.tact',
  options: {
    debug: true,
  },
};
