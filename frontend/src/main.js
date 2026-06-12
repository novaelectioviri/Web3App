import './index.css';
import {
  CONSENSUS_PERCENT,
  ESCROW_ADDRESS,
  GAS_RESERVE,
  MAX_CLAIM_BONUS,
  MIN_QUORUM,
  NETWORK,
  PROPOSAL_FEE,
  PROPOSAL_REFUND,
  ROUTES,
  VOTING_DURATION_SECONDS,
  VOTE_FEE,
  VOTE_LOCK,
} from './constants.js';
import { initTelegramBridge } from './telegram.js';
import {
  activeVotesCount,
  castVote,
  claimFor,
  createProposal,
  executeProposal,
  getCooldownInfo,
  loadState,
  saveState,
} from './state.js';
import {
  invalidateRpcCache,
  readContractReadiness,
  readVotingLockAssets,
  readVotingPower,
} from './rpc.js';
import {
  buildClaimForPayload,
  buildCreateProposalPayload,
  buildExecutePayload,
  buildJettonTransferPayload,
  buildNftTransferPayload,
  buildVotePayload,
  buildVoteLockJettonForwardPayload,
  buildVoteLockNftForwardPayload,
  connectedAddress,
  getTonConnectUI,
  isLegacyVoteEnabled,
  onWalletChange,
  sendClaimTx,
  sendCreateProposalTx,
  sendExecuteTx,
  sendJettonLockTx,
  sendNftLockTx,
  sendVoteTx,
} from './tonconnect.js';
import {
  deriveStatus,
  formatDateTime,
  formatDuration,
  formatTon,
  secondsUntil,
  validateTonAddress,
  yesPercent,
} from './utils.js';

const app = document.querySelector('#app');
if (!app) {
  throw new Error('Missing #app root');
}

let state = loadState();
let walletAddress = '';
let contractReadiness = {
  escrowActive: false,
  nftCollectionActive: false,
  jettonActive: false,
};
let votingPower = {
  nftCount: 0,
  jettonBalance: 0,
};
let voteModal = null;
let initialChainLoaded = false;
let tonConnectUI = null;
let tonConnectReady = false;
let tonConnectInitPromise = null;
let actionInProgress = {
  createProposal: false,
  executeByProposal: {},
  claimByProposalAndVoter: {},
  voteByProposal: {},
};

const LOCK_STEP = {
  idle: 'idle',
  sendingNft: 'sending-nft',
  nftSent: 'nft-sent',
  sendingJetton: 'sending-jetton',
  jettonSent: 'jetton-sent',
  finalizing: 'finalizing',
  accepted: 'accepted',
  failed: 'failed',
};

const LEGACY_VOTE_ENABLED = isLegacyVoteEnabled();

const routes = {
  [ROUTES.dashboard]: renderDashboard,
  [ROUTES.create]: renderCreateProposal,
  [ROUTES.votes]: renderActiveVotes,
  [ROUTES.claim]: renderClaimPanel,
};

initTelegramBridge();

setupNavigation();
render();
void refreshChainState().finally(() => {
  initialChainLoaded = true;
  render();
});
window.setInterval(() => {
  render();
}, 60_000);
window.setInterval(() => {
  void refreshChainState().then(() => {
    initialChainLoaded = true;
    render();
  });
}, 120_000);

window.addEventListener('hashchange', () => {
  render();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    void refreshChainState().then(() => render());
  }
});

/**
 * @returns {string}
 */
function currentRoute() {
  const hash = window.location.hash.slice(1) || ROUTES.dashboard;
  return routes[hash] ? hash : ROUTES.dashboard;
}

function setupNavigation() {
  if (!window.location.hash) {
    window.location.hash = `#${ROUTES.dashboard}`;
  }
}

async function refreshChainState() {
  try {
    contractReadiness = await readContractReadiness();
    if (walletAddress) {
      votingPower = await readVotingPower(walletAddress);
    } else {
      votingPower = { nftCount: 0, jettonBalance: 0 };
    }
  } catch {
    contractReadiness = {
      escrowActive: false,
      nftCollectionActive: false,
      jettonActive: false,
    };
    votingPower = { nftCount: 0, jettonBalance: 0 };
  }
}

function persist() {
  saveState(state);
}

function render() {
  const route = currentRoute();
  const view = routes[route];
  app.innerHTML = `
    <div class="safe-top safe-bottom min-h-screen flex flex-col pb-[80px]">
      <main class="flex-1 max-w-md mx-auto w-full px-4">
        ${view()}
      </main>
      ${renderBottomNav(route)}
      ${renderVoteModal()}
    </div>
  `;
  bindGlobalActions();
  if (tonConnectUI && tonConnectReady) {
    const connectRoot = document.querySelector('#ton-connect-button');
    if (connectRoot) {
      tonConnectUI.uiOptions = {
        buttonRootId: 'ton-connect-button',
        uiPreferences: { theme: 'SYSTEM' },
      };
    } else {
      tonConnectUI.uiOptions = {
        uiPreferences: { theme: 'SYSTEM' },
      };
    }
  }
}

/**
 * @param {string} route
 * @returns {string}
 */
function renderBottomNav(route) {
  const links = [
    { route: ROUTES.dashboard, icon: '🏠', label: 'Dashboard' },
    { route: ROUTES.create, icon: '➕', label: 'Create' },
    { route: ROUTES.votes, icon: '📊', label: 'Votes' },
    { route: ROUTES.claim, icon: '💎', label: 'Claim' },
  ];

  return `
    <nav class="fixed bottom-0 left-0 right-0 border-t" style="background: var(--bg); border-color: var(--border)">
      <div class="safe-bottom max-w-md mx-auto px-4 py-2 grid grid-cols-4 gap-2">
        ${links
          .map(
            (link) => `
          <a href="#${link.route}" class="nav-link ${route === link.route ? 'active' : ''}">
            <span>${link.icon}</span>
            <span>${link.label}</span>
          </a>
        `,
          )
          .join('')}
      </div>
    </nav>
  `;
}

/**
 * @returns {string}
 */
function walletShort() {
  if (!walletAddress) {
    return 'Not connected';
  }
  return `${walletAddress.slice(0, 5)}...${walletAddress.slice(-5)}`;
}

/**
 * @returns {string}
 */
function renderNetworkBadge() {
  const allReady =
    contractReadiness.escrowActive &&
    contractReadiness.nftCollectionActive &&
    contractReadiness.jettonActive;
  return `
    <div class="flex items-center gap-2 text-sm">
      <span class="inline-block w-2 h-2 rounded-full ${allReady ? 'bg-emerald-400' : 'bg-amber-400'}"></span>
      <span>${NETWORK} • ${allReady ? 'Contracts ready' : 'Waiting config/deploy'}</span>
    </div>
  `;
}

function renderDashboard() {
  const activeCount = activeVotesCount(state);
  return `
    <section class="space-y-4 py-2">
      <div class="flex items-center justify-between gap-3">
        <h1 class="text-2xl font-bold">TON Voting</h1>
        ${renderConnectControl()}
      </div>
      <div class="card space-y-2">
        <p class="text-xs" style="color: var(--hint)">Wallet</p>
        <div class="flex items-center justify-between gap-3">
          <span class="mono text-sm">${walletShort()}</span>
          <button class="btn-secondary" data-action="refresh-chain">Refresh RPC</button>
        </div>
        ${initialChainLoaded ? '' : `<p class="text-xs" style="color: var(--hint)">Loading on-chain state...</p>`}
        ${renderNetworkBadge()}
      </div>
      <div class="card grid grid-cols-2 gap-3">
        <div>
          <p class="text-xs" style="color: var(--hint)">Active votes</p>
          <p class="text-3xl font-bold" style="color: var(--button)">${activeCount}</p>
        </div>
        <div class="text-right">
          <p class="text-xs" style="color: var(--hint)">Consensus/Quorum</p>
          <p class="font-semibold">${CONSENSUS_PERCENT}% / ${MIN_QUORUM}</p>
        </div>
      </div>
      <div class="card space-y-2">
        <p class="text-xs" style="color: var(--hint)">Escrow fee pool (mocked UI state)</p>
        <div class="flex items-center justify-between">
          <p class="text-2xl font-bold">${formatTon(state.feeBalance)}</p>
          <span class="pill active">+fees from votes</span>
        </div>
        <p class="text-xs" style="color: var(--hint)">
          VOTE_FEE=${VOTE_FEE} TON, VOTE_LOCK=${VOTE_LOCK} TON, PROPOSAL_FEE=${PROPOSAL_FEE} TON
        </p>
      </div>
      <div class="card grid grid-cols-2 gap-2 text-sm">
        <div>
          <p style="color: var(--hint)">NFT voting power</p>
          <p class="text-xl font-semibold">${votingPower.nftCount}</p>
        </div>
        <div>
          <p style="color: var(--hint)">Jetton voting power</p>
          <p class="text-xl font-semibold">${votingPower.jettonBalance.toFixed(2)}</p>
        </div>
      </div>
      <div class="card text-xs space-y-1" style="color: var(--hint)">
        <p>Escrow: <span class="mono">${ESCROW_ADDRESS || 'not configured'}</span></p>
        <p>Voting duration: ${VOTING_DURATION_SECONDS / 3600}h</p>
        <p>Max claim bonus: ${MAX_CLAIM_BONUS} TON</p>
      </div>
    </section>
  `;
}

function renderConnectControl() {
  if (tonConnectReady) {
    return '<div id="ton-connect-button"></div>';
  }
  return '<button class="btn-secondary" data-action="init-connect">Connect</button>';
}

function renderCreateProposal() {
  const cooldown = getCooldownInfo(state, walletAddress);
  const createBusy = actionInProgress.createProposal;
  const canSubmit =
    walletAddress &&
    cooldown.canCreate &&
    votingPower.nftCount > 0 &&
    votingPower.jettonBalance > 0 &&
    !createBusy;
  return `
    <section class="space-y-4 py-2">
      <h1 class="text-2xl font-bold">Create Proposal</h1>
      <div class="card space-y-2 text-sm">
        <p class="text-xs" style="color: var(--hint)">Cooldown per proposer</p>
        ${
          walletAddress
            ? cooldown.canCreate
              ? `<p class="pill active inline-flex">Ready for new proposal</p>`
              : `<p class="pill expired inline-flex">Cooldown: ${formatDuration(cooldown.secondsLeft)}</p>`
            : `<p style="color: var(--warning)">Connect wallet to create proposal.</p>`
        }
        <p class="text-xs" style="color: var(--hint)">
          Frontend gate requires holder: NFT > 0 and Jetton > 0 (checked through RPC).
        </p>
      </div>
      <form id="create-proposal-form" class="card space-y-4">
        <div>
          <label class="input-label" for="proposal-title">Proposal title *</label>
          <input id="proposal-title" class="input-field" maxlength="100" required placeholder="Upgrade voting settings" />
        </div>
        <div>
          <label class="input-label" for="proposal-description">Description *</label>
          <textarea id="proposal-description" class="input-field min-h-24" maxlength="500" required placeholder="What should be changed and why"></textarea>
        </div>
        <div>
          <label class="input-label" for="proposal-target">target_address *</label>
          <div class="flex gap-2">
            <input id="proposal-target" class="input-field" placeholder="EQ... / UQ..." required />
            <button type="button" class="paste-btn" data-action="paste-target">📋</button>
          </div>
          <p id="target-hint" class="address-hint">TON address format: EQ/UQ + 48 chars.</p>
        </div>
        <div>
          <label class="input-label" for="proposal-amount">TON amount to transfer after consensus</label>
          <input id="proposal-amount" class="input-field" type="number" min="0" step="0.01" value="0" />
        </div>
        <div class="grid grid-cols-2 gap-2 text-xs" style="color: var(--hint)">
          <p>PROPOSAL_FEE: ${PROPOSAL_FEE} TON</p>
          <p>Total tx: ${PROPOSAL_FEE} + transfer amount</p>
          <p>PROPOSAL_REFUND: ${PROPOSAL_REFUND} TON</p>
        </div>
        <button class="btn-primary" type="submit" ${canSubmit ? '' : 'disabled'}>${createBusy ? 'Submitting...' : 'Submit Proposal'}</button>
      </form>
    </section>
  `;
}

function renderActiveVotes() {
  const cards = state.proposals
    .map((proposal) => {
      const voteProgress = actionInProgress.voteByProposal[proposal.id] ?? null;
      const voteBusy = Boolean(voteProgress && voteProgress.busy);
      const status = deriveStatus(proposal);
      const yes = yesPercent(proposal.yesVotes, proposal.noVotes);
      const timeLeft = secondsUntil(proposal.endAt);
      const nowTs = Math.floor(Date.now() / 1000);
      const totalVotes = proposal.yesVotes + proposal.noVotes;
      const consensusReached =
        totalVotes > 0 &&
        proposal.voters >= MIN_QUORUM &&
        yes >= CONSENSUS_PERCENT;
      const canVote = status === 'Active' || status === 'Consensus';
      const voteDisabled = !canVote || voteBusy;
      const canExecute =
        !proposal.executed &&
        nowTs >= proposal.endAt &&
        consensusReached;
      const executeBusy = Boolean(actionInProgress.executeByProposal[proposal.id]);
      const executeDisabled = !canExecute || executeBusy;
      return `
        <article class="card space-y-3">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="font-semibold">${escapeHtml(proposal.title)}</h3>
              <p class="text-xs mt-1" style="color: var(--hint)">
                #${proposal.id} • Target: <span class="mono">${escapeHtml(proposal.targetAddress)}</span>
              </p>
            </div>
            <span class="pill ${status.toLowerCase()}">${status}</span>
          </div>
          <p class="text-sm" style="color: var(--hint)">${escapeHtml(proposal.description)}</p>
          <div class="grid grid-cols-2 gap-2 text-xs">
            <p>Yes: <b>${proposal.yesVotes}</b></p>
            <p>No: <b>${proposal.noVotes}</b></p>
            <p>Yes%: <b>${yes}%</b></p>
            <p>Voters: <b>${proposal.voters}</b> / ${MIN_QUORUM}</p>
          </div>
          <div class="flex items-center justify-between text-xs" style="color: var(--hint)">
            <span>Ends: ${formatDateTime(proposal.endAt)}</span>
            <span>${timeLeft > 0 ? `⏱ ${formatDuration(timeLeft)}` : 'Deadline passed'}</span>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <button class="btn-secondary" data-action="vote" data-proposal="${proposal.id}" data-side="yes" ${voteDisabled ? 'disabled' : ''}>${voteBusy ? 'Voting...' : `Vote YES (${LEGACY_VOTE_ENABLED ? `+${VOTE_FEE + VOTE_LOCK}` : 'lock flow'})`}</button>
            <button class="btn-secondary" data-action="vote" data-proposal="${proposal.id}" data-side="no" ${voteDisabled ? 'disabled' : ''}>${voteBusy ? 'Voting...' : `Vote NO (${LEGACY_VOTE_ENABLED ? `+${VOTE_FEE + VOTE_LOCK}` : 'lock flow'})`}</button>
          </div>
          ${renderVoteProgress(voteProgress)}
          <button class="btn-secondary w-full" data-action="execute" data-proposal="${proposal.id}" ${executeDisabled ? 'disabled' : ''}>
            ${executeBusy ? 'Executing...' : 'Execute (if consensus and ended)'}
          </button>
        </article>
      `;
    })
    .join('');

  return `
    <section class="space-y-4 py-2">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold">Active Votes</h1>
        <span class="pill active">${activeVotesCount(state)} active/consensus</span>
      </div>
      ${cards || `<div class="card">No proposals yet</div>`}
    </section>
  `;
}

function renderClaimPanel() {
  const claimableRows = [];
  for (const proposal of state.proposals) {
    const status = deriveStatus(proposal);
    if (status !== 'Claimable' && status !== 'Consensus' && status !== 'Expired') {
      continue;
    }
    const pending = Object.values(proposal.voterStates).filter((v) => !v.claimed).length;
    if (pending <= 0) {
      continue;
    }

    for (const [voter, info] of Object.entries(proposal.voterStates)) {
      if (info.claimed) continue;
      const claimKey = makeClaimKey(proposal.id, voter);
      const claimBusy = Boolean(actionInProgress.claimByProposalAndVoter[claimKey]);
      claimableRows.push(`
        <div class="card space-y-2">
          <div class="flex items-center justify-between text-sm">
            <span>Proposal #${proposal.id}</span>
            <span class="pill claimable">Claimable</span>
          </div>
          <p class="text-xs" style="color: var(--hint)">
            voter=${escapeHtml(voter)} • NFT=${info.nftLocked} • Jetton=${info.jettonLocked.toFixed(2)}
          </p>
          <button class="btn-primary" data-action="claim" data-proposal="${proposal.id}" data-voter="${escapeHtml(voter)}" ${claimBusy ? 'disabled' : ''}>
            ${claimBusy ? 'Claiming...' : 'claim_for(voter)'}
          </button>
        </div>
      `);
    }
  }

  return `
    <section class="space-y-4 py-2">
      <h1 class="text-2xl font-bold">Claim Panel</h1>
      <div class="card space-y-2 text-sm">
        <p class="text-xs" style="color: var(--hint)">
          Bonus formula:
          min((fee_balance - pending*${GAS_RESERVE})*0.8/pending, ${MAX_CLAIM_BONUS})
        </p>
        <p class="text-xl font-semibold">${formatTon(state.feeBalance)}</p>
      </div>
      ${claimableRows.join('') || `<div class="card">Nothing claimable yet.</div>`}
    </section>
  `;
}

function renderVoteModal() {
  if (!voteModal) {
    return '';
  }

  const proposal = state.proposals.find((item) => item.id === voteModal.proposalId);
  if (!proposal) {
    voteModal = null;
    return '';
  }

  const voteProgress = actionInProgress.voteByProposal[proposal.id] ?? null;
  const voteBusy = Boolean(voteProgress && voteProgress.busy);

  return `
    <div class="fixed inset-0 bg-black/70 flex items-end md:items-center md:justify-center p-4" data-action="close-vote-modal">
      <div class="card w-full max-w-md space-y-3" data-modal="vote">
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-semibold">Vote Confirmation</h3>
          <button class="btn-secondary" data-action="cancel-vote">Close</button>
        </div>
        <p class="text-sm" style="color: var(--hint)">
          Proposal #${proposal.id}: ${escapeHtml(proposal.title)}
        </p>
        <p class="text-sm">
          Choice: <b>${voteModal.side.toUpperCase()}</b> • Flow: <b>${LEGACY_VOTE_ENABLED ? `legacy Vote (+${VOTE_FEE + VOTE_LOCK} TON)` : 'NFT lock → jetton lock → on-chain finalize'}</b>
        </p>
        <p class="text-xs" style="color: var(--hint)">
          ${LEGACY_VOTE_ENABLED ? 'Legacy vote path is enabled for migration.' : 'Assets are locked in escrow and final vote is accepted by contract after both locks.'}
        </p>
        <button class="btn-primary" data-action="confirm-vote" data-proposal="${proposal.id}" data-side="${voteModal.side}" ${voteBusy ? 'disabled' : ''}>
          ${voteBusy ? 'Voting...' : 'Confirm Vote'}
        </button>
      </div>
    </div>
  `;
}

function renderVoteProgress(progress) {
  if (!progress) {
    return '';
  }

  const nftStatus = renderStepStatus(
    progress.step,
    LOCK_STEP.nftSent,
    '1) lock NFT',
    progress.resumeFromJetton === true,
  );
  const jettonStatus = renderStepStatus(progress.step, LOCK_STEP.jettonSent, '2) lock jetton');
  const finalStatus = renderStepStatus(progress.step, LOCK_STEP.accepted, '3) vote accepted');
  const failed = progress.step === LOCK_STEP.failed;
  const accepted = progress.step === LOCK_STEP.accepted;

  return `
    <div class="vote-progress">
      <p class="vote-progress-title">Voting flow</p>
      <p class="vote-progress-line">${nftStatus}</p>
      <p class="vote-progress-line">${jettonStatus}</p>
      <p class="vote-progress-line">${finalStatus}</p>
      ${
        progress.message
          ? `<p class="vote-progress-message ${failed ? 'error' : accepted ? 'success' : ''}">${escapeHtml(progress.message)}</p>`
          : ''
      }
    </div>
  `;
}

function renderStepStatus(step, doneAtLeastStep, label, forceDone = false) {
  if (forceDone) {
    return `✓ ${label}`;
  }
  if (step === LOCK_STEP.failed) {
    return `⚠ ${label}`;
  }
  if (step === LOCK_STEP.finalizing && doneAtLeastStep === LOCK_STEP.accepted) {
    return `… ${label}`;
  }
  if (stepRank(step) >= stepRank(doneAtLeastStep)) {
    return `✓ ${label}`;
  }
  return `○ ${label}`;
}

function stepRank(step) {
  switch (step) {
    case LOCK_STEP.sendingNft:
      return 1;
    case LOCK_STEP.nftSent:
      return 2;
    case LOCK_STEP.sendingJetton:
      return 3;
    case LOCK_STEP.jettonSent:
      return 4;
    case LOCK_STEP.finalizing:
      return 5;
    case LOCK_STEP.accepted:
      return 6;
    case LOCK_STEP.failed:
      return 7;
    default:
      return 0;
  }
}

function bindGlobalActions() {
  document.querySelectorAll('[data-action="init-connect"]').forEach((button) => {
    button.addEventListener('click', async () => {
      await handleConnectClick();
    });
  });

  const refreshBtn = document.querySelector('[data-action="refresh-chain"]');
  refreshBtn?.addEventListener('click', async () => {
    invalidateRpcCache();
    await refreshChainState();
    render();
  });

  const pasteBtn = document.querySelector('[data-action="paste-target"]');
  if (pasteBtn) {
    pasteBtn.addEventListener('click', async () => {
      const input = document.querySelector('#proposal-target');
      if (!(input instanceof HTMLInputElement)) return;
      try {
        const text = await navigator.clipboard.readText();
        input.value = text.trim();
        validateTargetField();
      } catch {
        toast('Clipboard access denied');
      }
    });
  }

  const targetInput = document.querySelector('#proposal-target');
  targetInput?.addEventListener('input', () => validateTargetField());

  const createForm = document.querySelector('#create-proposal-form');
  if (createForm instanceof HTMLFormElement) {
    createForm.addEventListener('submit', (event) => {
      event.preventDefault();
      if (actionInProgress.createProposal) {
        return;
      }
      void handleCreateProposal();
    });
  }

  document.querySelectorAll('[data-action="vote"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const element = /** @type {HTMLElement} */ (btn);
      const proposalId = Number(element.dataset.proposal);
      const side = element.dataset.side === 'yes' ? 'yes' : 'no';
      if (actionInProgress.voteByProposal[proposalId]?.busy) {
        return;
      }
      openVoteModal(proposalId, side);
    });
  });

  const confirmVote = document.querySelector('[data-action="confirm-vote"]');
  if (confirmVote instanceof HTMLElement) {
    confirmVote.addEventListener('click', () => {
      const proposalId = Number(confirmVote.dataset.proposal);
      const side = confirmVote.dataset.side === 'yes' ? 'yes' : 'no';
      if (actionInProgress.voteByProposal[proposalId]?.busy) {
        return;
      }
      closeVoteModal();
      void handleVote(proposalId, side);
    });
  }

  document.querySelectorAll('[data-action="cancel-vote"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      closeVoteModal();
    });
  });

  const backdrop = document.querySelector('[data-action="close-vote-modal"]');
  if (backdrop instanceof HTMLElement) {
    backdrop.addEventListener('click', (event) => {
      if ((event.target instanceof HTMLElement) && event.target.dataset.action === 'close-vote-modal') {
        closeVoteModal();
      }
    });
  }

  document.querySelectorAll('[data-action="execute"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const element = /** @type {HTMLElement} */ (btn);
      const proposalId = Number(element.dataset.proposal);
      if (actionInProgress.executeByProposal[proposalId]) {
        return;
      }
      void handleExecute(proposalId);
    });
  });

  document.querySelectorAll('[data-action="claim"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const element = /** @type {HTMLElement} */ (btn);
      const proposalId = Number(element.dataset.proposal);
      const voter = element.dataset.voter ?? '';
      const claimKey = makeClaimKey(proposalId, voter);
      if (actionInProgress.claimByProposalAndVoter[claimKey]) {
        return;
      }
      void handleClaim(proposalId, voter);
    });
  });
}

async function handleConnectClick() {
  try {
    await ensureTonConnectReady();
    walletAddress = connectedAddress();
    render();

    if (!walletAddress && tonConnectUI) {
      await tonConnectUI.openModal();
    }
  } catch (error) {
    toast(explainError(error));
  }
}

function validateTargetField() {
  const input = document.querySelector('#proposal-target');
  const hint = document.querySelector('#target-hint');
  if (!(input instanceof HTMLInputElement) || !(hint instanceof HTMLElement)) {
    return true;
  }
  const value = input.value.trim();
  if (!value) {
    hint.className = 'address-hint';
    hint.textContent = 'TON address format: EQ/UQ + 48 chars.';
    input.classList.remove('error');
    return false;
  }
  if (validateTonAddress(value)) {
    hint.className = 'address-hint valid';
    hint.textContent = 'Address format is valid';
    input.classList.remove('error');
    return true;
  }
  hint.className = 'address-hint invalid';
  hint.textContent = 'Invalid TON address';
  input.classList.add('error');
  return false;
}

/**
 * @param {number} proposalId
 * @param {"yes" | "no"} side
 */
function openVoteModal(proposalId, side) {
  voteModal = { proposalId, side };
  render();
}

function closeVoteModal() {
  voteModal = null;
  render();
}

function makeClaimKey(proposalId, voter) {
  return `${proposalId}:${voter}`;
}

function setVoteProgress(proposalId, next) {
  actionInProgress.voteByProposal[proposalId] = next;
}

function clearVoteProgress(proposalId) {
  delete actionInProgress.voteByProposal[proposalId];
}

function getLocalProposalById(proposalId) {
  return state.proposals.find((proposal) => proposal.id === proposalId) ?? null;
}

async function handleCreateProposal() {
  if (actionInProgress.createProposal) {
    return;
  }
  actionInProgress.createProposal = true;
  render();
  try {
    await ensureTonConnectReady();

    walletAddress = connectedAddress();
    if (!walletAddress) {
      toast('Connect wallet first');
      return;
    }

    const cooldown = getCooldownInfo(state, walletAddress);
    if (!cooldown.canCreate) {
      toast(`Cooldown active: ${formatDuration(cooldown.secondsLeft)}`);
      return;
    }

    const titleInput = document.querySelector('#proposal-title');
    const descInput = document.querySelector('#proposal-description');
    const targetInput = document.querySelector('#proposal-target');
    const amountInput = document.querySelector('#proposal-amount');
    if (
      !(titleInput instanceof HTMLInputElement) ||
      !(descInput instanceof HTMLTextAreaElement) ||
      !(targetInput instanceof HTMLInputElement) ||
      !(amountInput instanceof HTMLInputElement)
    ) {
      return;
    }

    const title = titleInput.value.trim();
    const description = descInput.value.trim();
    const targetAddress = targetInput.value.trim();
    const amountTon = Number(amountInput.value || 0);
    if (!Number.isFinite(amountTon) || amountTon < 0) {
      toast('Amount must be non-negative');
      return;
    }
    if (!title || !description || !validateTargetField()) {
      toast('Fill all required fields');
      return;
    }

    const power = await readVotingPower(walletAddress);
    if (power.nftCount <= 0 || power.jettonBalance <= 0) {
      toast('Need NFT + Jetton balance for proposer gate');
      return;
    }

    const payloadBoc = await buildCreateProposalPayload({
      title,
      description,
      targetAddress,
      amountTon,
      nftProofCount: power.nftCount,
      jettonProofAmount: power.jettonBalance,
    });
    await sendCreateProposalTx({ payloadBoc, tonAmount: amountTon });

    createProposal(state, {
      title,
      description,
      targetAddress,
      amountTon,
      creator: walletAddress,
    });
    persist();
    toast(`Proposal submitted (+${PROPOSAL_FEE} TON)`);
    window.location.hash = `#${ROUTES.votes}`;
  } catch (error) {
    toast(explainError(error));
  } finally {
    actionInProgress.createProposal = false;
    render();
  }
}

/**
 * @param {number} proposalId
 * @param {"yes" | "no"} side
 */
async function handleVote(proposalId, side) {
  if (actionInProgress.voteByProposal[proposalId]?.busy) {
    return;
  }

  const previousProgress = actionInProgress.voteByProposal[proposalId] ?? null;
  const resumeJettonOnly = Boolean(
    !LEGACY_VOTE_ENABLED &&
      previousProgress &&
      previousProgress.step === LOCK_STEP.failed &&
      previousProgress.resumeFromJetton &&
      previousProgress.side === side,
  );

  setVoteProgress(proposalId, {
    busy: true,
    side,
    step: LOCK_STEP.idle,
    resumeFromJetton: resumeJettonOnly,
    message: LEGACY_VOTE_ENABLED
      ? 'Legacy vote path enabled'
      : resumeJettonOnly
        ? 'Resuming from jetton lock step...'
        : 'Preparing lock assets...',
  });
  render();

  try {
    await ensureTonConnectReady();
    walletAddress = connectedAddress();
    if (!walletAddress) {
      throw new Error('Connect wallet first');
    }

    const proposal = getLocalProposalById(proposalId);
    if (!proposal) {
      throw new Error('Proposal not found');
    }

    const proposalStatus = deriveStatus(proposal);
    if (proposalStatus !== 'Active' && proposalStatus !== 'Consensus') {
      throw new Error('Voting for this proposal is closed');
    }

    if (proposal.voterStates[walletAddress]) {
      throw new Error('Повторное голосование запрещено');
    }

    if (LEGACY_VOTE_ENABLED) {
      const power = await readVotingPower(walletAddress);
      if (power.nftCount <= 0) {
        throw new Error('Need at least 1 NFT to vote');
      }
      setVoteProgress(proposalId, {
        busy: true,
        side,
        step: LOCK_STEP.finalizing,
        resumeFromJetton: false,
        message: 'Sending legacy Vote...',
      });
      render();
      const payloadBoc = await buildVotePayload({
        proposalId,
        support: side === 'yes' ? 1 : 0,
        lockedNfts: power.nftCount,
        lockedJettons: power.jettonBalance,
      });
      await sendVoteTx({ payloadBoc });
      castVote(
        state,
        proposalId,
        walletAddress,
        side,
        power.nftCount,
        power.jettonBalance,
      );
      persist();
      setVoteProgress(proposalId, {
        busy: false,
        side,
        step: LOCK_STEP.accepted,
        resumeFromJetton: false,
        message: `Vote accepted (${side.toUpperCase()})`,
      });
      render();
      toast(`Vote submitted (${side.toUpperCase()})`);
      window.setTimeout(() => {
        const progress = actionInProgress.voteByProposal[proposalId];
        if (progress && !progress.busy && progress.step === LOCK_STEP.accepted) {
          clearVoteProgress(proposalId);
          render();
        }
      }, 2000);
      return;
    }

    const lockAssets = await readVotingLockAssets(walletAddress);
    if (lockAssets.nftCount <= 0 || !lockAssets.nftAddress) {
      throw new Error('No NFT from configured collection for lock step');
    }
    if (
      Number(lockAssets.suggestedJettonLockAmount) <= 0 ||
      !lockAssets.jettonWalletAddress
    ) {
      throw new Error('No jetton balance or wallet address for lock step');
    }

    const supportBit = side === 'yes' ? 1 : 0;
    if (!resumeJettonOnly) {
      setVoteProgress(proposalId, {
        busy: true,
        side,
        step: LOCK_STEP.sendingNft,
        resumeFromJetton: false,
        message: 'Step 1/3: sending NFT lock to escrow...',
      });
      render();

      const nftForwardPayloadBoc = await buildVoteLockNftForwardPayload({
        proposalId,
        support: supportBit,
        voter: walletAddress,
        lockedNfts: 1,
      });
      const nftTransferPayloadBoc = await buildNftTransferPayload({
        voterAddress: walletAddress,
        forwardPayloadBoc: nftForwardPayloadBoc,
      });
      await sendNftLockTx({
        nftAddress: lockAssets.nftAddress,
        payloadBoc: nftTransferPayloadBoc,
      });

      setVoteProgress(proposalId, {
        busy: true,
        side,
        step: LOCK_STEP.nftSent,
        resumeFromJetton: false,
        message: 'NFT lock sent. Waiting jetton lock...',
      });
      render();
    } else {
      setVoteProgress(proposalId, {
        busy: true,
        side,
        step: LOCK_STEP.nftSent,
        resumeFromJetton: true,
        message: 'Using previously sent NFT lock, continuing with jetton...',
      });
      render();
    }

    setVoteProgress(proposalId, {
      busy: true,
      side,
      step: LOCK_STEP.sendingJetton,
      resumeFromJetton: resumeJettonOnly,
      message: 'Step 2/3: sending jetton lock to escrow...',
    });
    render();

    const jettonForwardPayloadBoc = await buildVoteLockJettonForwardPayload({
      proposalId,
      support: supportBit,
      voter: walletAddress,
    });
    const jettonTransferPayloadBoc = await buildJettonTransferPayload({
      jettonRawAmount: lockAssets.suggestedJettonLockRaw,
      voterAddress: walletAddress,
      forwardPayloadBoc: jettonForwardPayloadBoc,
    });
    await sendJettonLockTx({
      jettonWalletAddress: lockAssets.jettonWalletAddress,
      payloadBoc: jettonTransferPayloadBoc,
    });

    setVoteProgress(proposalId, {
      busy: true,
      side,
      step: LOCK_STEP.jettonSent,
      resumeFromJetton: resumeJettonOnly,
      message: 'Jetton lock sent. Finalizing vote on-chain...',
    });
    render();

    setVoteProgress(proposalId, {
      busy: true,
      side,
      step: LOCK_STEP.finalizing,
      resumeFromJetton: resumeJettonOnly,
      message: 'Step 3/3: escrow finalizes vote from both lock notifications...',
    });
    render();

    castVote(
      state,
      proposalId,
      walletAddress,
      side,
      1,
      lockAssets.suggestedJettonLockAmount,
    );
    persist();
    invalidateRpcCache();
    await refreshChainState();

    setVoteProgress(proposalId, {
      busy: false,
      side,
      step: LOCK_STEP.accepted,
      resumeFromJetton: false,
      message: `Vote accepted (${side.toUpperCase()})`,
    });
    render();
    toast(`Vote lock flow submitted (${side.toUpperCase()})`);
    window.setTimeout(() => {
      const progress = actionInProgress.voteByProposal[proposalId];
      if (progress && !progress.busy && progress.step === LOCK_STEP.accepted) {
        clearVoteProgress(proposalId);
        render();
      }
    }, 4000);
  } catch (error) {
    const currentProgress = actionInProgress.voteByProposal[proposalId] ?? null;
    const canResumeFromJetton = Boolean(
      currentProgress &&
        stepRank(currentProgress.step) >= stepRank(LOCK_STEP.nftSent) &&
        stepRank(currentProgress.step) < stepRank(LOCK_STEP.accepted),
    );
    setVoteProgress(proposalId, {
      busy: false,
      side,
      step: LOCK_STEP.failed,
      resumeFromJetton: canResumeFromJetton,
      message: canResumeFromJetton
        ? `${explainError(error)}. Retry to continue from jetton step.`
        : explainError(error),
    });
    render();
    toast(explainError(error));
  }
}

/**
 * @param {number} proposalId
 */
async function handleExecute(proposalId) {
  if (actionInProgress.executeByProposal[proposalId]) {
    return;
  }
  actionInProgress.executeByProposal[proposalId] = true;
  render();
  try {
    await ensureTonConnectReady();
    const payloadBoc = await buildExecutePayload(proposalId);
    await sendExecuteTx({ payloadBoc });
    executeProposal(state, proposalId);
    persist();
    invalidateRpcCache();
    await refreshChainState();
    render();
    toast('Proposal executed');
  } catch (error) {
    toast(explainError(error));
  } finally {
    delete actionInProgress.executeByProposal[proposalId];
    render();
  }
}

/**
 * @param {number} proposalId
 * @param {string} voter
 */
async function handleClaim(proposalId, voter) {
  const claimKey = makeClaimKey(proposalId, voter);
  if (actionInProgress.claimByProposalAndVoter[claimKey]) {
    return;
  }
  actionInProgress.claimByProposalAndVoter[claimKey] = true;
  render();
  try {
    await ensureTonConnectReady();
    const proposal = getLocalProposalById(proposalId);
    if (!proposal) {
      throw new Error('Proposal not found');
    }
    const status = deriveStatus(proposal);
    if (status !== 'Consensus' && status !== 'Claimable' && status !== 'Expired') {
      throw new Error('Claim is not available for this proposal yet');
    }

    walletAddress = connectedAddress();
    if (!walletAddress) {
      toast('Connect wallet first');
      return;
    }
    const payloadBoc = await buildClaimForPayload({ proposalId, voter });
    await sendClaimTx(payloadBoc);
    const result = claimFor(state, proposalId, walletAddress, voter);
    persist();
    invalidateRpcCache();
    await refreshChainState();
    render();
    toast(
      `Claim success: released NFT=${result.releasedNft}, jetton=${result.releasedJetton.toFixed(2)}, bonus=${result.bonus.toFixed(3)} TON`,
    );
  } catch (error) {
    toast(explainError(error));
  } finally {
    delete actionInProgress.claimByProposalAndVoter[claimKey];
    render();
  }
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function explainError(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Operation failed';
}

/**
 * @param {string} message
 */
function toast(message) {
  console.info(`[web3app] ${message}`);
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function initTonConnectBridge() {
  tonConnectUI = await getTonConnectUI();
  tonConnectReady = true;
  walletAddress = connectedAddress();
  onWalletChange(async (address) => {
    walletAddress = address;
    await refreshChainState();
    render();
  });
  void tonConnectUI.connectionRestored;
  render();
}

async function ensureTonConnectReady() {
  if (tonConnectReady) {
    return;
  }
  if (!tonConnectInitPromise) {
    tonConnectInitPromise = initTonConnectBridge().finally(() => {
      tonConnectInitPromise = null;
    });
  }
  await tonConnectInitPromise;
  if (!tonConnectReady || !tonConnectUI) {
    throw new Error('TonConnect is unavailable');
  }
}

window.addEventListener('unhandledrejection', (event) => {
  const message = explainError(event.reason);
  toast(`Async error: ${message}`);
});
