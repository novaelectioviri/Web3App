import "@stdlib/deploy";
import "./tep62_messages.tact";

message Mint {
    queryId: Int as uint64;
    collection: Address;
    metadataUri: String;
}

const NFT_ITEM_DEPLOY_AMOUNT: Int = ton("0.01");
const MINT_FORWARD_VALUE: Int = ton("0.05");

contract NftMintController with Deployable {
    owner: Address;
    nextIndex: map<Address, Int as uint64>;

    init(owner: Address) {
        self.owner = owner;
    }

    receive(msg: Mint) {
        require(sender() == self.owner, "NOT_OWNER");

        let itemIndex: Int = 0;
        if (self.nextIndex.exists(msg.collection)) {
            itemIndex = self.nextIndex.get(msg.collection)!!;
        }

        let content: Cell = buildOffchainContent(msg.metadataUri);

        send(SendParameters{
            to: msg.collection,
            value: MINT_FORWARD_VALUE,
            mode: SendPayGasSeparately,
            bounce: false,
            body: Tep62Mint{
                queryId: msg.queryId,
                itemIndex: itemIndex,
                amount: NFT_ITEM_DEPLOY_AMOUNT,
                nftItemContent: content,
            }.toCell(),
        });

        self.nextIndex.set(msg.collection, itemIndex + 1);
    }

    get fun owner(): Address {
        return self.owner;
    }

    get fun nextIndex(collection: Address): Int? {
        return self.nextIndex.get(collection);
    }
}

inline fun buildOffchainContent(uri: String): Cell {
    return beginCell()
        .storeUint(0x01, 8)
        .storeSlice(beginString().concat(uri).toSlice())
        .endCell();
}
