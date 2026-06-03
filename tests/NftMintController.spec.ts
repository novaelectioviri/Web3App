import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, beginCell, toNano } from '@ton/core';
import { NftMintController } from '../wrappers/NftMintController';
import { MockNftCollection } from '../wrappers/MockNftCollection';
import '@ton/test-utils';

const METADATA_URI = 'https://example.com/nft/voter-1.json';

describe('NftMintController', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let attacker: SandboxContract<TreasuryContract>;
    let controller: SandboxContract<NftMintController>;
    let collection: SandboxContract<MockNftCollection>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');
        attacker = await blockchain.treasury('attacker');

        controller = blockchain.openContract(
            await NftMintController.fromInit(deployer.address),
        );

        collection = blockchain.openContract(
            await MockNftCollection.fromInit(controller.address),
        );

        const deployController = await controller.send(
            deployer.getSender(),
            { value: toNano('0.05') },
            { $$type: 'Deploy', queryId: 0n },
        );

        expect(deployController.transactions).toHaveTransaction({
            from: deployer.address,
            to: controller.address,
            deploy: true,
            success: true,
        });

        const deployCollection = await collection.send(
            deployer.getSender(),
            { value: toNano('0.05') },
            { $$type: 'Deploy', queryId: 0n },
        );

        expect(deployCollection.transactions).toHaveTransaction({
            from: deployer.address,
            to: collection.address,
            deploy: true,
            success: true,
        });
    });

    it('should deploy with correct owner', async () => {
        expect(await controller.getOwner()).toEqualAddress(deployer.address);
    });

    it('should mint NFT into collection with TEP-62 body', async () => {
        const mintResult = await controller.send(
            deployer.getSender(),
            { value: toNano('0.1') },
            {
                $$type: 'Mint',
                queryId: 1n,
                collection: collection.address,
                metadataUri: METADATA_URI,
            },
        );

        expect(mintResult.transactions).toHaveTransaction({
            from: controller.address,
            to: collection.address,
            success: true,
            body: (body) => {
                if (!(body instanceof Cell)) {
                    return false;
                }
                const slice = body.beginParse();
                return slice.loadUint(32) === 0x249cbfa1;
            },
        });

        expect(await collection.getMintCount()).toBe(1n);
        const content = await collection.getLastContent();
        expect(content).not.toBeNull();
        const contentSlice = content!.beginParse();
        expect(contentSlice.loadUint(8)).toBe(0x01);
        expect(contentSlice.loadStringTail()).toBe(METADATA_URI);
        expect(await controller.getNextIndex(collection.address)).toBe(1n);
    });

    it('should increment item index on sequential mints', async () => {
        await controller.send(
            deployer.getSender(),
            { value: toNano('0.1') },
            {
                $$type: 'Mint',
                queryId: 1n,
                collection: collection.address,
                metadataUri: `${METADATA_URI}?id=1`,
            },
        );

        await controller.send(
            deployer.getSender(),
            { value: toNano('0.1') },
            {
                $$type: 'Mint',
                queryId: 2n,
                collection: collection.address,
                metadataUri: `${METADATA_URI}?id=2`,
            },
        );

        expect(await collection.getMintCount()).toBe(2n);
        expect(await controller.getNextIndex(collection.address)).toBe(2n);
    });

    it('should reject mint from non-owner', async () => {
        const mintResult = await controller.send(
            attacker.getSender(),
            { value: toNano('0.1') },
            {
                $$type: 'Mint',
                queryId: 99n,
                collection: collection.address,
                metadataUri: METADATA_URI,
            },
        );

        expect(mintResult.transactions).toHaveTransaction({
            from: attacker.address,
            to: controller.address,
            success: false,
        });

        expect(await collection.getMintCount()).toBe(0n);
    });

    it('should build TEP-64 off-chain content cell', () => {
        const content = beginCell()
            .storeUint(0x01, 8)
            .storeStringTail(METADATA_URI)
            .endCell();

        const slice = content.beginParse();
        expect(slice.loadUint(8)).toBe(0x01);
        expect(slice.loadStringTail()).toBe(METADATA_URI);
    });
});
