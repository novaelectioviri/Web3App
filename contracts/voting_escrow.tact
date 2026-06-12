import "@stdlib/deploy";

message(0x43525052) CreateProposal {
    queryId: Int as uint64;
    targetAddress: Address;
    tonAmount: Int as coins;
    targetPayload: Cell?;
    nftProofCount: Int as uint16;
    jettonProofAmount: Int as coins;
}

message(0x564f5445) Vote {
    queryId: Int as uint64;
    proposalId: Int as uint32;
    support: Int as uint1;
    lockedNfts: Int as uint16;
    lockedJettons: Int as coins;
}

message(0x45584543) ExecuteProposal {
    queryId: Int as uint64;
    proposalId: Int as uint32;
}

message(0x434c4d46) ClaimFor {
    queryId: Int as uint64;
    proposalId: Int as uint32;
    voter: Address;
}

message(0x43464741) ConfigureAssets {
    queryId: Int as uint64;
    jettonWallet: Address;
}

message(0x05138d91) NftOwnershipAssigned {
    queryId: Int as uint64;
    prevOwner: Address;
    forwardPayload: Slice as remaining;
}

message(0x7362d09c) JettonTransferNotification {
    queryId: Int as uint64;
    amount: Int as coins;
    sender: Address;
    forwardPayload: Slice as remaining;
}

message(0x5fcc3d14) NftTransfer {
    queryId: Int as uint64;
    newOwner: Address;
    responseDestination: Address;
    customPayload: Cell?;
    forwardAmount: Int as coins;
    forwardPayload: Slice as remaining;
}

message(0x0f8a7ea5) JettonTransfer {
    queryId: Int as uint64;
    amount: Int as coins;
    destination: Address;
    responseDestination: Address;
    customPayload: Cell?;
    forwardTonAmount: Int as coins;
    forwardPayload: Slice as remaining;
}

const VOTE_FEE: Int = ton("0.5");
const PROPOSAL_FEE: Int = ton("2.0");
const PROPOSAL_REFUND: Int = ton("1.0");
const VOTING_DURATION: Int = 75600;
const CONSENSUS: Int = 75;
const MIN_QUORUM: Int = 3;
const MAX_CLAIM_BONUS: Int = ton("0.3");
const GAS_RESERVE: Int = ton("0.15");
const VOTE_LOCK: Int = GAS_RESERVE;
const NFT_RETURN_GAS: Int = ton("0.05");
const JETTON_RETURN_GAS: Int = ton("0.05");
const CLAIM_RELEASE_OPCODE: Int = 0x434c4149;

contract VotingEscrow with Deployable {
    owner: Address;
    jettonWallet: Address;
    feeBalance: Int as coins;
    nextProposalId: Int as uint32;
    reentryLock: Int as uint1;

    proposerCooldownUntil: map<Address, Int as uint32>;

    proposalCreator: map<Int, Address>;
    proposalTarget: map<Int, Address>;
    proposalTonAmount: map<Int, Int as coins>;
    proposalPayload: map<Int, Cell>;
    proposalCreatedAt: map<Int, Int as uint32>;
    proposalEndAt: map<Int, Int as uint32>;
    proposalYesVotes: map<Int, Int as uint16>;
    proposalNoVotes: map<Int, Int as uint16>;
    proposalVoters: map<Int, Int as uint16>;
    proposalExecuted: map<Int, Int as uint1>;
    proposalRefunded: map<Int, Int as uint1>;
    proposalPendingClaims: map<Int, Int as uint16>;
    proposalClaimedAll: map<Int, Int as uint1>;

    voteChoiceByKey: map<Int, Int as uint1>;
    voteClaimedByKey: map<Int, Int as uint1>;
    voteNftLockedByKey: map<Int, Int as uint16>;
    voteJettonLockedByKey: map<Int, Int as coins>;
    voteNftAddressByKey: map<Int, Address>;
    voteOwnerByKey: map<Int, Address>;
    voteProposalByKey: map<Int, Int as uint32>;
    voteSideByKey: map<Int, Int as uint1>;

    nftLockCountByKey: map<Int, Int as uint16>;
    jettonLockByKey: map<Int, Int as coins>;
    pendingSupportByKey: map<Int, Int as uint1>;
    pendingJettonSenderByKey: map<Int, Address>;
    pendingReadyByKey: map<Int, Int as uint1>;

    init(owner: Address) {
        self.owner = owner;
        self.jettonWallet = owner;
        self.feeBalance = 0;
        self.nextProposalId = 1;
        self.reentryLock = 0;
    }

    receive(msg: ConfigureAssets) {
        require(sender() == self.owner, "NOT_OWNER");
        self.jettonWallet = msg.jettonWallet;
    }

    receive(msg: CreateProposal) {
        require(msg.nftProofCount > 0, "NFT_GATE_FAIL");
        require(msg.jettonProofAmount > 0, "JETTON_GATE_FAIL");
        let minProposalValue = PROPOSAL_FEE + msg.tonAmount;
        require(context().value >= minProposalValue, "LOW_PROPOSAL_VALUE");

        let nowTs = now();
        let cooldownUntil: Int = 0;
        if (self.proposerCooldownUntil.exists(sender())) {
            cooldownUntil = self.proposerCooldownUntil.get(sender())!!;
        }
        require(nowTs >= cooldownUntil, "COOLDOWN_ACTIVE");

        let proposalId = self.nextProposalId;
        self.nextProposalId = proposalId + 1;

        let payload: Cell = beginCell().endCell();
        if (msg.targetPayload != null) {
            payload = msg.targetPayload!!;
        }

        self.proposalCreator.set(proposalId, sender());
        self.proposalTarget.set(proposalId, msg.targetAddress);
        self.proposalTonAmount.set(proposalId, msg.tonAmount);
        self.proposalPayload.set(proposalId, payload);
        self.proposalCreatedAt.set(proposalId, nowTs);
        self.proposalEndAt.set(proposalId, nowTs + VOTING_DURATION);
        self.proposalYesVotes.set(proposalId, 0);
        self.proposalNoVotes.set(proposalId, 0);
        self.proposalVoters.set(proposalId, 0);
        self.proposalExecuted.set(proposalId, 0);
        self.proposalRefunded.set(proposalId, 0);
        self.proposalPendingClaims.set(proposalId, 0);
        self.proposalClaimedAll.set(proposalId, 0);
        self.proposerCooldownUntil.set(sender(), nowTs + VOTING_DURATION);

        self.feeBalance = safeAdd(self.feeBalance, PROPOSAL_FEE);
    }

    receive(msg: Vote) {
        self.castVoteInternal(
            msg.proposalId,
            sender(),
            msg.support,
            msg.lockedNfts,
            msg.lockedJettons,
            context().value >= VOTE_FEE + VOTE_LOCK
        );
    }

    receive(msg: ExecuteProposal) {
        require(self.proposalCreator.exists(msg.proposalId), "UNKNOWN_PROPOSAL");
        require(self.proposalExecuted.get(msg.proposalId)!! == 0, "ALREADY_EXECUTED");
        require(now() >= self.proposalEndAt.get(msg.proposalId)!!, "VOTING_ACTIVE");

        let yesVotes = self.proposalYesVotes.get(msg.proposalId)!!;
        let noVotes = self.proposalNoVotes.get(msg.proposalId)!!;
        let voters = self.proposalVoters.get(msg.proposalId)!!;
        let totalVotes = yesVotes + noVotes;

        require(totalVotes > 0, "NO_VOTES");
        require(voters >= MIN_QUORUM, "LOW_QUORUM");
        require((yesVotes * 100) / totalVotes >= CONSENSUS, "NO_CONSENSUS");

        require(self.reentryLock == 0, "REENTRY");
        self.reentryLock = 1;

        self.feeBalance = safeSubGas(self.feeBalance, GAS_RESERVE);

        let target = self.proposalTarget.get(msg.proposalId)!!;
        let tonAmount = self.proposalTonAmount.get(msg.proposalId)!!;
        let payload = self.proposalPayload.get(msg.proposalId)!!;

        send(SendParameters{
            to: target,
            value: tonAmount,
            mode: SendPayGasSeparately,
            bounce: false,
            body: payload,
        });

        if (self.proposalRefunded.get(msg.proposalId)!! == 0) {
            self.feeBalance = safeSubRefund(self.feeBalance, PROPOSAL_REFUND);
            send(SendParameters{
                to: self.proposalCreator.get(msg.proposalId)!!,
                value: PROPOSAL_REFUND,
                mode: SendPayGasSeparately,
                bounce: false,
            });
            self.proposalRefunded.set(msg.proposalId, 1);
        }

        self.proposalExecuted.set(msg.proposalId, 1);
        self.reentryLock = 0;
    }

    receive(msg: NftOwnershipAssigned) {
        let fwd = msg.forwardPayload;
        let op = fwd.loadUint(32);
        require(op == 0x564f5445, "NFT_BAD_PAYLOAD");

        let proposalId = fwd.loadUint(32);
        let support = fwd.loadUint(1);
        let voter = fwd.loadAddress();
        let nftCount = fwd.loadUint(16);

        let lockKey = makeVoteKey(proposalId, voter);
        require(!self.voteChoiceByKey.exists(lockKey), "ALREADY_VOTED");
        require(voter == sender() || msg.prevOwner == voter, "NFT_OWNER_MISMATCH");

        let existing = 0;
        if (self.nftLockCountByKey.exists(lockKey)) {
            existing = self.nftLockCountByKey.get(lockKey)!!;
        }
        self.nftLockCountByKey.set(lockKey, existing + nftCount);
        self.voteNftAddressByKey.set(lockKey, sender());
        self.pendingSupportByKey.set(lockKey, support);
        self.pendingReadyByKey.set(lockKey, 1);
        self.tryFinalizeVote(lockKey, proposalId, voter);
    }

    receive(msg: JettonTransferNotification) {
        require(sender() == self.jettonWallet, "JETTON_WALLET_ONLY");

        let fwd = msg.forwardPayload;
        let op = fwd.loadUint(32);
        require(op == 0x564f5445, "JETTON_BAD_PAYLOAD");

        let proposalId = fwd.loadUint(32);
        let support = fwd.loadUint(1);
        let voter = fwd.loadAddress();

        let lockKey = makeVoteKey(proposalId, voter);
        require(!self.voteChoiceByKey.exists(lockKey), "ALREADY_VOTED");
        require(msg.sender == voter, "JETTON_OWNER_MISMATCH");

        self.jettonLockByKey.set(lockKey, msg.amount);
        self.pendingJettonSenderByKey.set(lockKey, msg.sender);
        self.pendingSupportByKey.set(lockKey, support);
        self.pendingReadyByKey.set(lockKey, 1);
        self.tryFinalizeVote(lockKey, proposalId, voter);
    }

    receive(msg: ClaimFor) {
        require(self.proposalCreator.exists(msg.proposalId), "UNKNOWN_PROPOSAL");
        require(now() >= self.proposalEndAt.get(msg.proposalId)!!, "VOTING_ACTIVE");

        let key = makeVoteKey(msg.proposalId, msg.voter);
        require(self.voteChoiceByKey.exists(key), "NO_VOTE_LOCK");
        require(self.voteClaimedByKey.get(key)!! == 0, "ALREADY_CLAIMED");

        let pendingClaims = self.proposalPendingClaims.get(msg.proposalId)!!;
        require(pendingClaims > 0, "NO_PENDING_CLAIMS");

        require(self.reentryLock == 0, "REENTRY");
        self.reentryLock = 1;

        let reserveNeed = pendingClaims * GAS_RESERVE;
        let bonus: Int = 0;
        if (self.feeBalance > reserveNeed) {
            let freePool = self.feeBalance - reserveNeed;
            bonus = (freePool * 8) / (10 * pendingClaims);
            if (bonus > MAX_CLAIM_BONUS) {
                bonus = MAX_CLAIM_BONUS;
            }
        }

        self.voteClaimedByKey.set(key, 1);
        self.proposalPendingClaims.set(msg.proposalId, pendingClaims - 1);
        if (pendingClaims - 1 == 0) {
            self.proposalClaimedAll.set(msg.proposalId, 1);
        }

        self.feeBalance = safeSubClaimGas(self.feeBalance, GAS_RESERVE);
        let releaseBody = beginCell()
            .storeUint(CLAIM_RELEASE_OPCODE, 32)
            .storeUint(self.voteNftLockedByKey.get(key)!!, 16)
            .storeCoins(self.voteJettonLockedByKey.get(key)!!)
            .endCell();

        if (self.voteNftAddressByKey.exists(key)) {
            let nftTransfer = NftTransfer{
                queryId: msg.queryId,
                newOwner: msg.voter,
                responseDestination: self.owner,
                customPayload: null,
                forwardAmount: 0,
                forwardPayload: beginCell().endCell().beginParse(),
            }.toCell();
            send(SendParameters{
                to: self.voteNftAddressByKey.get(key)!!,
                value: NFT_RETURN_GAS,
                mode: SendPayGasSeparately,
                bounce: false,
                body: nftTransfer,
            });
        }

        if (self.voteJettonLockedByKey.get(key)!! > 0) {
            let jettonTransfer = JettonTransfer{
                queryId: msg.queryId,
                amount: self.voteJettonLockedByKey.get(key)!!,
                destination: msg.voter,
                responseDestination: self.owner,
                customPayload: null,
                forwardTonAmount: 0,
                forwardPayload: beginCell().endCell().beginParse(),
            }.toCell();
            send(SendParameters{
                to: self.jettonWallet,
                value: JETTON_RETURN_GAS,
                mode: SendPayGasSeparately,
                bounce: false,
                body: jettonTransfer,
            });
        }

        send(SendParameters{
            to: msg.voter,
            value: GAS_RESERVE,
            mode: SendPayGasSeparately,
            bounce: false,
            body: releaseBody,
        });

        if (bonus > 0) {
            self.feeBalance = safeSubBonus(self.feeBalance, bonus);
            send(SendParameters{
                to: sender(),
                value: bonus,
                mode: SendPayGasSeparately,
                bounce: false,
            });
        }

        self.reentryLock = 0;
    }

    get fun feeBalance(): Int {
        return self.feeBalance;
    }

    get fun jettonWallet(): Address {
        return self.jettonWallet;
    }

    get fun proposalCount(): Int {
        return self.nextProposalId - 1;
    }

    get fun proposerCooldownUntil(addr: Address): Int? {
        return self.proposerCooldownUntil.get(addr);
    }

    get fun proposalCreator(proposalId: Int): Address? {
        return self.proposalCreator.get(proposalId);
    }

    get fun proposalTarget(proposalId: Int): Address? {
        return self.proposalTarget.get(proposalId);
    }

    get fun proposalEndAt(proposalId: Int): Int? {
        return self.proposalEndAt.get(proposalId);
    }

    get fun proposalVotes(proposalId: Int): Int {
        if (!self.proposalYesVotes.exists(proposalId) || !self.proposalNoVotes.exists(proposalId)) {
            return 0;
        }
        return self.proposalYesVotes.get(proposalId)!! + self.proposalNoVotes.get(proposalId)!!;
    }

    get fun proposalYesVotes(proposalId: Int): Int? {
        return self.proposalYesVotes.get(proposalId);
    }

    get fun proposalNoVotes(proposalId: Int): Int? {
        return self.proposalNoVotes.get(proposalId);
    }

    get fun proposalVoters(proposalId: Int): Int? {
        return self.proposalVoters.get(proposalId);
    }

    get fun proposalPendingClaims(proposalId: Int): Int? {
        return self.proposalPendingClaims.get(proposalId);
    }

    get fun proposalExecuted(proposalId: Int): Int? {
        return self.proposalExecuted.get(proposalId);
    }

    get fun proposalClaimedAll(proposalId: Int): Int? {
        return self.proposalClaimedAll.get(proposalId);
    }

    get fun voteClaimed(proposalId: Int, voter: Address): Int? {
        return self.voteClaimedByKey.get(makeVoteKey(proposalId, voter));
    }
    
}

inline fun safeAdd(value: Int, amount: Int): Int {
    let next = value + amount;
    require(next >= value, "FEE_OVERFLOW");
    return next;
}

inline fun safeSubGas(value: Int, amount: Int): Int {
    require(value >= amount, "FEE_UNDERFLOW_GAS");
    return value - amount;
}

inline fun safeSubRefund(value: Int, amount: Int): Int {
    require(value >= amount, "FEE_UNDERFLOW_REFUND");
    return value - amount;
}

inline fun safeSubClaimGas(value: Int, amount: Int): Int {
    require(value >= amount, "FEE_UNDERFLOW_CLAIM_GAS");
    return value - amount;
}

inline fun safeSubBonus(value: Int, amount: Int): Int {
    require(value >= amount, "FEE_UNDERFLOW_BONUS");
    return value - amount;
}

inline fun makeVoteKey(proposalId: Int, voter: Address): Int {
    return beginCell()
        .storeUint(proposalId, 32)
        .storeAddress(voter)
        .endCell()
        .hash();
}

extends mutates fun castVoteInternal(
    self: VotingEscrow,
    proposalId: Int,
    voter: Address,
    support: Int,
    lockedNfts: Int,
    lockedJettons: Int,
    enforceLockValue: Bool
) {
    if (enforceLockValue) {
        require(context().value >= VOTE_FEE + VOTE_LOCK, "LOW_VOTE_LOCK");
    }

    require(self.proposalCreator.exists(proposalId), "UNKNOWN_PROPOSAL");
    let endAt = self.proposalEndAt.get(proposalId)!!;
    require(now() < endAt, "VOTING_ENDED");

    let key = makeVoteKey(proposalId, voter);
    require(!self.voteChoiceByKey.exists(key), "ALREADY_VOTED");
    require(lockedNfts > 0, "NFT_LOCK_REQUIRED");

    let yesVotes = self.proposalYesVotes.get(proposalId)!!;
    let noVotes = self.proposalNoVotes.get(proposalId)!!;
    let voters = self.proposalVoters.get(proposalId)!!;
    let pendingClaims = self.proposalPendingClaims.get(proposalId)!!;

    if (support == 1) {
        self.proposalYesVotes.set(proposalId, yesVotes + 1);
    } else {
        self.proposalNoVotes.set(proposalId, noVotes + 1);
    }
    self.proposalVoters.set(proposalId, voters + 1);
    self.proposalPendingClaims.set(proposalId, pendingClaims + 1);

    self.voteChoiceByKey.set(key, support);
    self.voteClaimedByKey.set(key, 0);
    self.voteNftLockedByKey.set(key, lockedNfts);
    self.voteJettonLockedByKey.set(key, lockedJettons);
    self.voteOwnerByKey.set(key, voter);
    self.voteProposalByKey.set(key, proposalId);

    if (self.pendingSupportByKey.exists(key)) {
        self.pendingSupportByKey.del(key);
    }
    if (self.pendingReadyByKey.exists(key)) {
        self.pendingReadyByKey.del(key);
    }
    if (self.nftLockCountByKey.exists(key)) {
        self.nftLockCountByKey.del(key);
    }
    if (self.jettonLockByKey.exists(key)) {
        self.jettonLockByKey.del(key);
    }
    if (self.pendingJettonSenderByKey.exists(key)) {
        self.pendingJettonSenderByKey.del(key);
    }

    self.feeBalance = safeAdd(self.feeBalance, VOTE_FEE);
}

extends mutates fun tryFinalizeVote(self: VotingEscrow, key: Int, proposalId: Int, voter: Address) {
    if (!self.pendingReadyByKey.exists(key) || self.pendingReadyByKey.get(key)!! == 0) {
        return;
    }
    if (!self.pendingSupportByKey.exists(key)) {
        return;
    }
    if (!self.nftLockCountByKey.exists(key)) {
        return;
    }
    if (!self.jettonLockByKey.exists(key)) {
        return;
    }

    self.castVoteInternal(
        proposalId,
        voter,
        self.pendingSupportByKey.get(key)!!,
        self.nftLockCountByKey.get(key)!!,
        self.jettonLockByKey.get(key)!!,
        false
    );
}
