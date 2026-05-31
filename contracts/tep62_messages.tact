// TEP-62 compatible mint body (GetGems / reference implementation opcode)
message(0x249cbfa1) Tep62Mint {
    queryId: Int as uint64;
    itemIndex: Int as uint64;
    amount: Int as coins;
    nftItemContent: Cell;
}
