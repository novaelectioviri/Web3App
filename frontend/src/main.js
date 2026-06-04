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
import { readContractReadiness, readVotingPower } from './rpc.js';
import {
  buildClaimForPayload,
  buildCreateProposalPayload,
  buildExecutePayload,
  buildVotePayload,
  connectedAddress,
  getTonConnectUI,
  onWalletChange,
  sendClaimTx,
  sendCreateProposalTx,
  sendExecuteTx,
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

const routes = {
  [ROUTES.dashboard]: renderDashboard,
  [ROUTES.create]: renderCreateProposal,
  [ROUTES.votes]: renderActiveVotes,
  [ROUTES.claim]: renderClaimPanel,
};

initTelegramBridge();
const tonConnectUI = getTonConnectUI();
walletAddress = connectedAddress();
onWalletChange(async (address) => {
  walletAddress = address;
  await refreshChainState();
  render();
});

setupNavigation();
void refreshChainState().finally(() => {
  render();
  window.setInterval(() => render(), 1000);
});

window.addEventListener('hashchange', () => {
  render();
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
  contractReadiness = await readContractReadiness();
  if (walletAddress) {
    votingPower = await readVotingPower(walletAddress);
  } else {
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
        <div id="ton-connect-button"></div>
      </div>
      <div class="card space-y-2">
        <p class="text-xs" style="color: var(--hint)">Wallet</p>
        <div class="flex items-center justify-between gap-3">
          <span class="mono text-sm">${walletShort()}</span>
          <button class="btn-secondary" data-action="refresh-chain">Refresh RPC</button>
        </div>
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
          VOTE_FEE=${VOTE_FEE} TON, PROPOSAL_FEE=${PROPOSAL_FEE} TON, GAS_RESERVE=${GAS_RESERVE} TON
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

function renderCreateProposal() {
  const cooldown = getCooldownInfo(state, walletAddress);
  const canSubmit = walletAddress && cooldown.canCreate;
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
          <p>PROPOSAL_REFUND: ${PROPOSAL_REFUND} TON</p>
        </div>
        <button class="btn-primary" type="submit" ${canSubmit ? '' : 'disabled'}>Submit Proposal</button>
      </form>
    </section>
  `;
}

function renderActiveVotes() {
  const cards = state.proposals
    .map((proposal) => {
      const status = deriveStatus(proposal);
      const yes = yesPercent(proposal.yesVotes, proposal.noVotes);
      const timeLeft = secondsUntil(proposal.endAt);
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
            <button class="btn-secondary" data-action="vote" data-proposal="${proposal.id}" data-side="yes">Vote YES (+${VOTE_FEE} TON)</button>
            <button class="btn-secondary" data-action="vote" data-proposal="${proposal.id}" data-side="no">Vote NO (+${VOTE_FEE} TON)</button>
          </div>
          <button class="btn-secondary w-full" data-action="execute" data-proposal="${proposal.id}">
            Execute (if consensus and ended)
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
      claimableRows.push(`
        <div class="card space-y-2">
          <div class="flex items-center justify-between text-sm">
            <span>Proposal #${proposal.id}</span>
            <span class="pill claimable">Claimable</span>
          </div>
          <p class="text-xs" style="color: var(--hint)">
            voter=${escapeHtml(voter)} • NFT=${info.nftLocked} • Jetton=${info.jettonLocked.toFixed(2)}
          </p>
          <button class="btn-primary" data-action="claim" data-proposal="${proposal.id}" data-voter="${escapeHtml(voter)}">
            claim_for(voter)
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
          Choice: <b>${voteModal.side.toUpperCase()}</b> • Fee: <b>${VOTE_FEE} TON</b>
        </p>
        <p class="text-xs" style="color: var(--hint)">
          Your NFT and Jetton voting assets will be marked as locked until claim phase.
        </p>
        <button class="btn-primary" data-action="confirm-vote" data-proposal="${proposal.id}" data-side="${voteModal.side}">
          Confirm Vote
        </button>
      </div>
    </div>
  `;
}

function bindGlobalActions() {
  const refreshBtn = document.querySelector('[data-action="refresh-chain"]');
  refreshBtn?.addEventListener('click', async () => {
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
      void handleCreateProposal();
    });
  }

  document.querySelectorAll('[data-action="vote"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const element = /** @type {HTMLElement} */ (btn);
      const proposalId = Number(element.dataset.proposal);
      const side = element.dataset.side === 'yes' ? 'yes' : 'no';
      openVoteModal(proposalId, side);
    });
  });

  const confirmVote = document.querySelector('[data-action="confirm-vote"]');
  if (confirmVote instanceof HTMLElement) {
    confirmVote.addEventListener('click', () => {
      const proposalId = Number(confirmVote.dataset.proposal);
      const side = confirmVote.dataset.side === 'yes' ? 'yes' : 'no';
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
      void handleExecute(proposalId);
    });
  });

  document.querySelectorAll('[data-action="claim"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const element = /** @type {HTMLElement} */ (btn);
      const proposalId = Number(element.dataset.proposal);
      const voter = element.dataset.voter ?? '';
      void handleClaim(proposalId, voter);
    });
  });
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

async function handleCreateProposal() {
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
  if (!title || !description || !validateTargetField()) {
    toast('Fill all required fields');
    return;
  }

  const power = await readVotingPower(walletAddress);
  if (power.nftCount <= 0 || power.jettonBalance <= 0) {
    toast('Need NFT + Jetton balance for proposer gate');
    return;
  }

  try {
    const payloadBoc = await buildCreateProposalPayload({
      title,
      description,
      targetAddress,
      amountTon,
      nftProofCount: power.nftCount,
      jettonProofAmount: power.jettonBalance,
    });
    await sendCreateProposalTx({ payloadBoc });
  } catch (error) {
    toast(explainError(error));
    return;
  }

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
}

/**
 * @param {number} proposalId
 * @param {"yes" | "no"} side
 */
async function handleVote(proposalId, side) {
  if (!walletAddress) {
    toast('Connect wallet first');
    return;
  }
  const power = await readVotingPower(walletAddress);
  if (power.nftCount <= 0 && power.jettonBalance <= 0) {
    toast('No voting assets detected');
    return;
  }
  try {
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
    render();
    toast(`Vote submitted (${side.toUpperCase()})`);
  } catch (error) {
    toast(explainError(error));
  }
}

/**
 * @param {number} proposalId
 */
async function handleExecute(proposalId) {
  try {
    const payloadBoc = await buildExecutePayload(proposalId);
    await sendExecuteTx({ payloadBoc });
    executeProposal(state, proposalId);
    persist();
    render();
    toast('Proposal executed');
  } catch (error) {
    toast(explainError(error));
  }
}

/**
 * @param {number} proposalId
 * @param {string} voter
 */
async function handleClaim(proposalId, voter) {
  if (!walletAddress) {
    toast('Connect wallet first');
    return;
  }
  try {
    const payloadBoc = await buildClaimForPayload({ proposalId, voter });
    await sendClaimTx(payloadBoc);
    const result = claimFor(state, proposalId, walletAddress, voter);
    persist();
    render();
    toast(
      `Claim success: released NFT=${result.releasedNft}, jetton=${result.releasedJetton.toFixed(2)}, bonus=${result.bonus.toFixed(3)} TON`,
    );
  } catch (error) {
    toast(explainError(error));
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

void tonConnectUI.connectionRestored;
