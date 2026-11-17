// Agent Draw — mint website logic (read-only by default, wallet only for mint/claim/draw).
// Contract: AgentDraw 0xdC167f998341aA37D734de94db2108F0983bf2A7 on BSC (chain 56).
// v2 deployed 17 Nov 2026. Period 1 ends Fri 20 Nov 2026 15:46 WIB (unix 1795164400).

const CONTRACT_ADDRESS = '0xdC167f998341aA37D734de94db2108F0983bf2A7';
const AGENT_ID_ADDRESS = '0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F';
const DEPLOY_BLOCK = 134085445;
const BSC_CHAIN_ID = 56;
const BSCSCAN = 'https://bscscan.com';

const RPC_URLS = [
  'https://bsc-rpc.publicnode.com',
  'https://bsc-dataseed.binance.org',
  'https://bsc-dataseed2.bnbchain.org',
];

const AGENT_DRAW_ABI = [
  'function pool() view returns (uint256)',
  'function periodId() view returns (uint256)',
  'function periodStart() view returns (uint256)',
  'function periodEnd() view returns (uint256)',
  'function timeLeft() view returns (uint256)',
  'function ticketPrice() view returns (uint256)',
  'function drawThreshold() view returns (uint256)',
  'function cutActivation() view returns (uint256)',
  'function ticketsSold() view returns (uint256)',
  'function freeMinted() view returns (uint256)',
  'function FREE_TICKET_SUPPLY() view returns (uint256)',
  'function hasClaimedFree(address) view returns (bool)',
  'function mintedInPeriod(uint256,address) view returns (uint256)',
  'function claimable(uint256) view returns (uint256)',
  'function claimDeadline(uint256) view returns (uint256)',
  'function ticketPeriod(uint256) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
  'function name() view returns (string)',
  'function mintTicket() payable',
  'function mintFreeTicket() payable',
  'function draw()',
  'function claim(uint256)',
  'function sweepUnclaimed(uint256)',
  'event TicketMinted(uint256 indexed periodId, address indexed buyer, uint256 indexed tokenId)',
  'event FreeTicketMinted(uint256 indexed periodId, address indexed buyer, uint256 indexed tokenId)',
  'event PeriodExtended(uint256 indexed periodId, uint256 newEnd, uint256 pool)',
  'event Drawn(uint256 indexed periodId, uint256 indexed mainTicket, uint256[5] smallTickets, uint256 mainPrize, uint256 smallPrizeEach, uint256 projectCut, uint256 pool)',
  'event Claimed(uint256 indexed tokenId, address indexed winner, uint256 amount)',
  'event UnclaimedSwept(uint256 indexed tokenId, uint256 amount, uint256 indexed intoPeriodId)',
];

const AGENT_ID_ABI = ['function balanceOf(address) view returns (uint256)'];

const $ = (id) => document.getElementById(id);
const fmtBNB = (wei) => {
  const v = Number(ethers.formatEther(wei));
  return v.toLocaleString('en-US', { maximumFractionDigits: 6 });
};
const fmtWIB = (unixSeconds) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(unixSeconds * 1000)) + ' WIB';
const shortAddr = (a) => a.slice(0, 6) + '…' + a.slice(-4);
const txLink = (hash) => `${BSCSCAN}/tx/${hash}`;

let readProvider = null;
let contract = null;
let signer = null;
let signerContract = null;
let userAddress = null;
let state = { periodEnd: 0, periodId: 0, ticketPrice: 0n, drawThreshold: 0n, freeMinted: 0n, freeSupply: 1000n, pool: 0n };

async function connectReadProvider() {
  for (const url of RPC_URLS) {
    try {
      const p = new ethers.JsonRpcProvider(url);
      await p.getBlockNumber();
      readProvider = p;
      contract = new ethers.Contract(CONTRACT_ADDRESS, AGENT_DRAW_ABI, p);
      $('rpc-status').textContent = 'Connected to BNB Smart Chain (read-only). No wallet needed to view the board.';
      return true;
    } catch (e) { /* try next RPC */ }
  }
  $('rpc-status').textContent = 'Could not reach a BSC RPC endpoint. Please refresh and try again.';
  return false;
}

const MULTICALL_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';
const MULTICALL_ABI = ['function aggregate((address target, bytes callData)[] calls) view returns (uint256 blockNumber, bytes[] returnData)'];
// The nine board values, read in ONE eth_call via Multicall3 (a single call
// is far more reliable than nine parallel calls on throttled public RPCs).
const BOARD_FNS = ['pool', 'periodId', 'periodEnd', 'ticketPrice', 'drawThreshold', 'cutActivation', 'freeMinted', 'FREE_TICKET_SUPPLY', 'ticketsSold'];

async function readBoardState() {
  try {
    const iface = new ethers.Interface(AGENT_DRAW_ABI);
    const calls = BOARD_FNS.map((fn) => ({ target: CONTRACT_ADDRESS, callData: iface.encodeFunctionData(fn, []) }));
    const multi = new ethers.Contract(MULTICALL_ADDRESS, MULTICALL_ABI, readProvider);
    const [, results] = await multi.aggregate(calls);
    const out = {};
    BOARD_FNS.forEach((fn, i) => { out[fn] = iface.decodeFunctionResult(fn, results[i])[0]; });
    return out;
  } catch (e) {
    // Fallback: individual calls (works when Multicall3 is unavailable).
    const [pool, periodId, periodEnd, price, threshold, cutAct, freeMinted, freeSupply, sold] =
      await Promise.all([
        contract.pool(), contract.periodId(), contract.periodEnd(), contract.ticketPrice(),
        contract.drawThreshold(), contract.cutActivation(), contract.freeMinted(),
        contract.FREE_TICKET_SUPPLY(), contract.ticketsSold(),
      ]);
    return { pool, periodId, periodEnd, ticketPrice: price, drawThreshold: threshold,
      cutActivation: cutAct, freeMinted, FREE_TICKET_SUPPLY: freeSupply, ticketsSold: sold };
  }
}

async function refreshBoard() {
  if (!contract) return;
  try {
    const { pool, periodId, periodEnd, ticketPrice: price, drawThreshold: threshold, cutActivation: cutAct, freeMinted, FREE_TICKET_SUPPLY: freeSupply, ticketsSold: sold } =
      await readBoardState();
    state = { periodEnd: Number(periodEnd), periodId: Number(periodId), ticketPrice: price,
      drawThreshold: threshold, freeMinted, freeSupply, pool };

    $('period-id').textContent = periodId;
    $('pool').textContent = fmtBNB(pool) + ' BNB';
    $('tickets-sold').textContent = sold.toString();
    $('free-minted').textContent = freeMinted.toString() + ' / ' + freeSupply.toString();
    $('period-end-label').textContent = 'period ends ' + fmtWIB(Number(periodEnd));
    $('threshold-text').textContent =
      'Draw runs when the pool reaches ' + fmtBNB(threshold) + ' BNB. ' +
      'Below that, the period extends 24h. ' +
      (cutAct > 0n ? 'Project cut (10%) activates once a period pool reaches ' + fmtBNB(cutAct) + ' BNB.' : '');

    const pct = threshold > 0n ? Math.min(100, Number((pool * 10000n) / threshold) / 100) : 0;
    $('pool-progress').style.width = pct + '%';

    // Draw box: show when the period has ended.
    const now = Math.floor(Date.now() / 1000);
    $('draw-box').classList.toggle('hidden', now < Number(periodEnd));
    updateCountdown();
  } catch (e) {
    $('rpc-status').textContent = 'Error reading the contract: ' + e.message;
  }
}

function updateCountdown() {
  if (!state.periodEnd) return;
  const left = state.periodEnd - Math.floor(Date.now() / 1000);
  if (left <= 0) { $('countdown').textContent = 'ended'; return; }
  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  $('countdown').textContent = (d ? d + 'd ' : '') + String(h).padStart(2, '0') + 'h ' +
    String(m).padStart(2, '0') + 'm ' + String(s).padStart(2, '0') + 's';
}

async function connectWallet() {
  if (!window.ethereum) {
    $('wallet-panel').innerHTML = '<p class="muted">No wallet detected. Install MetaMask (or another injected wallet) and open this page in a browser with the wallet available.</p>';
    return;
  }
  try {
    const provider = new ethers.BrowserProvider(window.ethereum);
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== BSC_CHAIN_ID) {
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0x38' }],
        });
      } catch (switchErr) {
        if (switchErr.code === 4902) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{ chainId: '0x38', chainName: 'BNB Smart Chain',
              nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
              rpcUrls: ['https://bsc-dataseed.binance.org'], blockExplorerUrls: [BSCSCAN] }],
          });
        } else { throw switchErr; }
      }
    }
    signer = await provider.getSigner();
    userAddress = await signer.getAddress();
    signerContract = new ethers.Contract(CONTRACT_ADDRESS, AGENT_DRAW_ABI, signer);
    $('network-badge').textContent = 'BSC · ' + shortAddr(userAddress);
    $('network-badge').classList.add('ok');
    $('connect-btn').textContent = shortAddr(userAddress);
    $('wallet-panel').classList.add('hidden');
    $('gate-panel').classList.remove('hidden');
    $('my-tickets-section').classList.remove('hidden');
    await refreshGate();
    await refreshMyTickets();
  } catch (e) {
    $('wallet-panel').innerHTML = '<p class="muted">Wallet connection failed: ' + e.message + '</p>';
  }
}

async function refreshGate() {
  if (!userAddress || !contract) return;
  $('wallet-address').textContent = userAddress;
  try {
    const agentId = new ethers.Contract(AGENT_ID_ADDRESS, AGENT_ID_ABI, readProvider);
    const [idBal, claimedFree, mintedThis] = await Promise.all([
      agentId.balanceOf(userAddress),
      contract.hasClaimedFree(userAddress),
      contract.mintedInPeriod(state.periodId, userAddress),
    ]);
    const hasId = idBal > 0n;
    const freeLeft = state.freeMinted < state.freeSupply;
    const freeBadge = $('agent-id-status');
    freeBadge.textContent = hasId ? 'Held (' + idBal.toString() + ')' : 'Not held';
    freeBadge.classList.toggle('ok', hasId);
    freeBadge.classList.toggle('no', !hasId);
    $('free-status').textContent = claimedFree
      ? 'Already claimed (1 per wallet, lifetime)'
      : (freeLeft ? 'Available — you have not claimed yours yet' : 'Free supply exhausted (1000/1000)');
    $('free-btn').disabled = !(hasId && !claimedFree && freeLeft);
    // Paid tickets are open to everyone (no Agent ID needed). Only the
    // 10-per-period cap applies.
    $('buy-btn').disabled = !(mintedThis < 10n);
    $('buy-cost').textContent = 'Cost: ' + fmtBNB(state.ticketPrice) + ' BNB each · you minted ' +
      mintedThis.toString() + '/10 this period' +
      (hasId ? '' : ' · no Agent ID — you can still buy paid tickets');
  } catch (e) {
    $('free-status').textContent = 'Could not check: ' + e.message;
  }
}

async function myTicketIds() {
  const [paid, free] = await Promise.all([
    contract.queryFilter(contract.filters.TicketMinted(null, userAddress), DEPLOY_BLOCK, 'latest'),
    contract.queryFilter(contract.filters.FreeTicketMinted(null, userAddress), DEPLOY_BLOCK, 'latest'),
  ]);
  const ids = [...paid, ...free].map((e) => Number(e.args.tokenId));
  // Keep only tickets still owned by this wallet.
  const owned = [];
  for (const id of ids) {
    try { if ((await contract.ownerOf(id)).toLowerCase() === userAddress.toLowerCase()) owned.push(id); }
    catch (e) { /* token burned/transferred oddly — skip */ }
  }
  return owned.sort((a, b) => a - b);
}

async function refreshMyTickets() {
  if (!userAddress || !contract) return;
  const box = $('my-tickets');
  box.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const ids = await myTicketIds();
    if (ids.length === 0) { box.innerHTML = '<p class="muted">No tickets yet. Claim a free ticket or buy one above.</p>'; return; }
    const rows = [];
    for (const id of ids) {
      const [period, amount, deadline, owner] = await Promise.all([
        contract.ticketPeriod(id), contract.claimable(id), contract.claimDeadline(id), contract.ownerOf(id),
      ]);
      const now = Math.floor(Date.now() / 1000);
      let action = '';
      if (amount > 0n && now <= Number(deadline)) {
        action = '<button class="btn btn-ghost" data-claim="' + id + '">Claim ' + fmtBNB(amount) + ' BNB</button>';
      } else if (amount > 0n) {
        action = '<button class="btn btn-ghost" data-sweep="' + id + '">Sweep expired prize to pool</button>';
      }
      rows.push('<tr><td>#' + id + '</td><td>' + (Number(period) === state.periodId ? 'Current' : 'Period ' + period) +
        '</td><td>' + (amount > 0n ? fmtBNB(amount) + ' BNB' : '—') + '</td><td>' + action + '</td></tr>');
    }
    box.innerHTML = '<table><thead><tr><th>Ticket</th><th>Period</th><th>Claimable prize</th><th></th></tr></thead><tbody>' +
      rows.join('') + '</tbody></table>';
    box.querySelectorAll('[data-claim]').forEach((b) => b.addEventListener('click', () => claimTicket(Number(b.dataset.claim))));
    box.querySelectorAll('[data-sweep]').forEach((b) => b.addEventListener('click', () => sweepTicket(Number(b.dataset.sweep))));
  } catch (e) {
    box.innerHTML = '<p class="muted">Could not load tickets: ' + e.message + '</p>';
  }
}

async function claimTicket(tokenId) {
  await sendTx(() => signerContract.claim(tokenId), 'Claiming ticket #' + tokenId + '…', 'mint-status');
  await refreshBoard(); await refreshMyTickets();
}

async function sweepTicket(tokenId) {
  await sendTx(() => signerContract.sweepUnclaimed(tokenId), 'Sweeping ticket #' + tokenId + '…', 'mint-status');
  await refreshBoard(); await refreshMyTickets();
}

async function sendTx(fn, pendingText, statusElId) {
  const el = $(statusElId);
  el.textContent = pendingText;
  try {
    const tx = await fn();
    el.innerHTML = 'Transaction sent: <a href="' + txLink(tx.hash) + '" target="_blank" rel="noopener">' + tx.hash + '</a> — waiting for confirmation…';
    const receipt = await tx.wait();
    if (receipt.status === 1) {
      el.innerHTML = 'Confirmed! <a href="' + txLink(tx.hash) + '" target="_blank" rel="noopener">View on BscScan</a>';
    } else {
      el.textContent = 'Transaction failed on-chain. See BscScan: ' + txLink(tx.hash);
    }
  } catch (e) {
    el.textContent = 'Transaction failed: ' + (e.reason || e.message);
  }
}

async function claimFree() {
  await sendTx(() => signerContract.mintFreeTicket(), 'Claiming your free ticket…', 'mint-status');
  await refreshBoard(); await refreshGate(); await refreshMyTickets();
}

async function buyTickets() {
  const qty = Math.max(1, Math.min(10, parseInt($('qty').value, 10) || 1));
  const el = $('mint-status');
  for (let i = 0; i < qty; i++) {
    el.textContent = 'Buying ticket ' + (i + 1) + ' of ' + qty + ' — confirm in your wallet…';
    try {
      const tx = await signerContract.mintTicket({ value: state.ticketPrice });
      el.innerHTML = 'Ticket ' + (i + 1) + ' sent: <a href="' + txLink(tx.hash) + '" target="_blank" rel="noopener">' + tx.hash + '</a> — confirming…';
      const receipt = await tx.wait();
      if (receipt.status !== 1) { el.textContent = 'Ticket ' + (i + 1) + ' failed on-chain. Stopped.'; break; }
    } catch (e) {
      el.textContent = 'Ticket ' + (i + 1) + ' failed: ' + (e.reason || e.message) + ' — stopped.';
      break;
    }
    if (i === qty - 1) el.textContent = 'Done — ' + qty + ' ticket(s) bought. Good luck!';
  }
  await refreshBoard(); await refreshGate(); await refreshMyTickets();
}

async function runDraw() {
  await sendTx(() => signerContract.draw(), 'Running the draw…', 'draw-status');
  await refreshBoard(); await refreshWinners();
}

async function refreshWinners() {
  const box = $('winners');
  try {
    const draws = await contract.queryFilter(contract.filters.Drawn, DEPLOY_BLOCK, 'latest');
    if (draws.length === 0) {
      box.innerHTML = '<p class="muted">No winners yet — the first draw runs when Period 1 closes (Fri 20 Nov 2026, 15:46 WIB) and the pool reaches 0.005 BNB.</p>';
      return;
    }
    const rows = [];
    for (const d of [...draws].reverse()) {
      const { periodId: p, mainTicket, smallTickets, mainPrize, smallPrizeEach, projectCut, pool } = d.args;
      const mainOwner = await contract.ownerOf(mainTicket).catch(() => '—');
      const smallOwners = [];
      for (const t of smallTickets) smallOwners.push(await contract.ownerOf(t).catch(() => '—'));
      rows.push('<tr><td>Period ' + p + '</td><td>#' + mainTicket + '<br><span class="muted">' + shortAddr(mainOwner) +
        '</span></td><td>' + fmtBNB(mainPrize) + ' BNB</td><td>' +
        smallTickets.map((t, i) => '#' + t + ' (' + fmtBNB(smallPrizeEach) + ' BNB)').join('<br>') +
        '</td><td>' + fmtBNB(projectCut) + ' BNB</td><td><a href="' + txLink(d.transactionHash) +
        '" target="_blank" rel="noopener">tx</a></td></tr>');
    }
    box.innerHTML = '<table><thead><tr><th>Period</th><th>Main winner</th><th>Main prize</th><th>Small winners (5 ×)</th><th>Project cut</th><th></th></tr></thead><tbody>' +
      rows.join('') + '</tbody></table>';
  } catch (e) {
    box.innerHTML = '<p class="muted">Could not load winners: ' + e.message + '</p>';
  }
}

function wireUp() {
  const contractUrl = BSCSCAN + '/address/' + CONTRACT_ADDRESS;
  $('contract-link').href = contractUrl;
  $('contract-link-footer').href = contractUrl;
  $('contract-link-footer').textContent = CONTRACT_ADDRESS;
  $('connect-btn').addEventListener('click', connectWallet);
  $('free-btn').addEventListener('click', claimFree);
  $('buy-btn').addEventListener('click', buyTickets);
  $('draw-btn').addEventListener('click', runDraw);
  $('qty').addEventListener('input', () => {
    const q = Math.max(1, Math.min(10, parseInt($('qty').value, 10) || 1));
    $('qty').value = q;
    $('buy-cost').textContent = 'Cost: ' + fmtBNB(state.ticketPrice * BigInt(q)) + ' BNB total';
  });
  if (window.ethereum) {
    window.ethereum.on('accountsChanged', () => location.reload());
    window.ethereum.on('chainChanged', () => location.reload());
  }
}

(async () => {
  wireUp();
  const ok = await connectReadProvider();
  if (ok) {
    await refreshBoard();
    await refreshWinners();
    setInterval(updateCountdown, 1000);
    setInterval(refreshBoard, 30000);
    setInterval(refreshWinners, 60000);
  }
})();
