import "@stdlib/deploy";
import "./tep62_messages.tact";

// Minimal TEP-62 collection mock for sandbox tests.
contract MockNftCollection with Deployable {
    owner: Address;
    nextItemIndex: Int as uint64;
    mintCount: Int as uint32;
    lastContent: Cell?;

    init(owner: Address) {
        self.owner = owner;
        self.nextItemIndex = 0;
        self.mintCount = 0;
        self.lastContent = null;
    }

    receive(msg: Tep62Mint) {
        require(sender() == self.owner, "NOT_COLLECTION_OWNER");
        require(msg.itemIndex == self.nextItemIndex, "INVALID_ITEM_INDEX");
        require(context().value >= msg.amount, "LOW_MINT_VALUE");

        self.lastContent = msg.nftItemContent;
        self.nextItemIndex = self.nextItemIndex + 1;
        self.mintCount = self.mintCount + 1;
    }

    get fun collectionOwner(): Address {
        return self.owner;
    }

    get fun nextItemIndex(): Int {
        return self.nextItemIndex;
    }

    get fun mintCount(): Int {
        return self.mintCount;
    }

    get fun lastContent(): Cell? {
        return self.lastContent;
    }
}
