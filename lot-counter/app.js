/* ============================================
   LOT COUNTER — Application Logic
   Raptile Studio Edition
   ============================================ */

// ── State ──
const State = {
  products: [],
  lots: [],
  storeUrl: 'https://raptilestudio.myshopify.com',
  currentPage: 'products',
  lastSync: null,
  syncInterval: 5, // minutes
  autoSyncTimer: null,
  isDirty: false
};

// ── Persistence ──
function save() {
  localStorage.setItem('lotCounter', JSON.stringify({
    products: State.products,
    lots: State.lots,
    storeUrl: State.storeUrl,
    lastSync: State.lastSync,
    syncInterval: State.syncInterval,
  }));
  updateSaveStatus();
}

function updateSaveStatus() {
  const statusEl = document.getElementById('saveStatus');
  if (!statusEl) return;
  
  statusEl.classList.add('saving');
  statusEl.style.opacity = '1';
  
  setTimeout(() => {
    statusEl.classList.remove('saving');
    statusEl.classList.add('saved');
    setTimeout(() => {
      statusEl.style.opacity = '0';
      statusEl.classList.remove('saved');
    }, 2000);
  }, 300);
}

function load() {
  try {
    const raw = localStorage.getItem('lotCounter');
    if (raw) {
      const data = JSON.parse(raw);
      State.products = data.products || [];
      State.lots = data.lots || [];
      State.storeUrl = data.storeUrl || 'https://raptilestudio.myshopify.com';
      State.lastSync = data.lastSync || null;
      State.syncInterval = data.syncInterval || 5;
    }
  } catch (e) {
    console.error('Failed to load data', e);
  }
}

// ── Utilities ──
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function toast(msg, type = 'info') {
  const c = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function timeAgo(dateStr) {
  if (!dateStr) return 'never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const COLOR_MAP = {
  black: '#111111', white: '#f5f5f5', red: '#cc3333', blue: '#3355cc',
  green: '#33aa55', brown: '#8B4513', navy: '#001f3f', grey: '#808080',
  gray: '#808080', pink: '#ff69b4', yellow: '#ffd700', orange: '#ff8c00',
  purple: '#8a2be2', beige: '#f5f5dc', cream: '#fffdd0', maroon: '#800000',
  olive: '#808000', teal: '#008080', tan: '#d2b48c', khaki: '#c3b091',
};

function getColorHex(name) {
  if (!name) return '#888';
  return COLOR_MAP[name.toLowerCase()] || '#888';
}

// ── Navigation ──
function navigate(page) {
  State.currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pageEl = document.getElementById(`page-${page}`);
  const navEl = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (pageEl) pageEl.classList.add('active');
  if (navEl) navEl.classList.add('active');
  renderCurrentPage();
  document.querySelector('.sidebar')?.classList.remove('open');
}

function renderCurrentPage() {
  switch (State.currentPage) {
    case 'products': renderProducts(); break;
    case 'lots': renderLots(); break;
    case 'settings': renderSettings(); break;
  }
  updateNavBadges();
  updateSyncStatus();
}

function updateNavBadges() {
  const pb = document.querySelector('.nav-item[data-page="products"] .nav-badge');
  const lb = document.querySelector('.nav-item[data-page="lots"] .nav-badge');
  if (pb) pb.textContent = State.products.length;
  if (lb) lb.textContent = State.lots.length;
}

function updateSyncStatus() {
  const dot = document.querySelector('.sync-dot');
  const timeEl = document.getElementById('syncTime');
  if (timeEl) {
    timeEl.textContent = State.lastSync ? `Last sync: ${timeAgo(State.lastSync)}` : 'Not synced yet';
  }
}

// ══════════════════════════════
//  AUTO-SYNC SYSTEM
// ══════════════════════════════

function startAutoSync() {
  if (State.autoSyncTimer) clearInterval(State.autoSyncTimer);

  // Auto-sync on first load if never synced
  if (!State.lastSync && State.storeUrl) {
    setTimeout(() => silentSync(), 1000);
  }

  // Set interval
  State.autoSyncTimer = setInterval(() => {
    silentSync();
  }, State.syncInterval * 60 * 1000);
}

async function silentSync() {
  const dot = document.querySelector('.sync-dot');
  if (dot) dot.classList.add('syncing');

  try {
    const products = await fetchShopifyProducts();
    if (products && products.length > 0) {
      mergeProducts(products);
      State.lastSync = new Date().toISOString();
      save();
      renderCurrentPage();
    }
  } catch (err) {
    console.warn('Auto-sync failed:', err.message);
  } finally {
    if (dot) dot.classList.remove('syncing');
    updateSyncStatus();
  }
}

async function syncNow() {
  const btn = document.querySelector('.sync-btn');
  if (btn) {
    btn.classList.add('loading');
    btn.textContent = 'SYNCING...';
  }

  const dot = document.querySelector('.sync-dot');
  if (dot) dot.classList.add('syncing');

  try {
    const products = await fetchShopifyProducts();
    if (products && products.length > 0) {
      const count = mergeProducts(products);
      State.lastSync = new Date().toISOString();
      save();
      renderCurrentPage();
      toast(`Synced ${products.length} products`, 'success');
    } else {
      toast('No products found', 'error');
    }
  } catch (err) {
    toast(`Sync failed: ${err.message}`, 'error');
  } finally {
    if (btn) {
      btn.classList.remove('loading');
      btn.textContent = 'SYNC NOW';
    }
    if (dot) dot.classList.remove('syncing');
    updateSyncStatus();
  }
}

async function fetchShopifyProducts() {
  let baseUrl = State.storeUrl.replace(/\/$/, '');
  if (!baseUrl.startsWith('http')) baseUrl = 'https://' + baseUrl;

  let allProducts = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const resp = await fetch(`${baseUrl}/products.json?limit=250&page=${page}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (data.products && data.products.length > 0) {
      allProducts = allProducts.concat(data.products);
      page++;
      if (data.products.length < 250) hasMore = false;
    } else {
      hasMore = false;
    }
  }

  return allProducts;
}

function mergeProducts(shopifyProducts) {
  let count = 0;
  shopifyProducts.forEach(sp => {
    const colors = [];
    const sizes = [];
    (sp.options || []).forEach(opt => {
      const name = opt.name.toLowerCase();
      if (name === 'color' || name === 'colour') colors.push(...opt.values);
      else if (name === 'size') sizes.push(...opt.values);
    });

    const img = sp.images?.[0]?.src || '';

    const existing = State.products.find(p => p.name.toLowerCase() === sp.title.toLowerCase());
    if (existing) {
      existing.image = img || existing.image;
      existing.colors = colors.length > 0 ? colors : existing.colors;
      existing.sizes = sizes.length > 0 ? sizes : existing.sizes;
    } else {
      State.products.push({
        id: genId(),
        name: sp.title,
        image: img,
        colors,
        sizes,
      });
    }
    count++;
  });
  return count;
}

// ══════════════════════════════
//  PRODUCTS PAGE
// ══════════════════════════════

function renderProducts() {
  const container = document.getElementById('productsContent');
  const searchVal = (document.getElementById('productSearch')?.value || '').toLowerCase();

  const filtered = State.products.filter(p =>
    p.name.toLowerCase().includes(searchVal)
  );

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📦</div>
        <h3>No Products Yet</h3>
        <p>Products will sync automatically from your Shopify store, or add them manually.</p>
        <button class="btn btn-primary" onclick="openAddProductModal()">+ Add Product</button>
      </div>
    `;
    return;
  }

  container.innerHTML = `<div class="product-grid">${filtered.map(p => renderProductCard(p)).join('')}</div>`;
}

function renderProductCard(p) {
  const img = p.image
    ? `<img class="product-card-image" src="${p.image}" alt="${escHtml(p.name)}" onerror="this.style.display='none'">`
    : `<div class="product-card-image" style="display:flex;align-items:center;justify-content:center;font-size:2rem;color:rgba(255,255,255,0.15);">📦</div>`;

  const colors = (p.colors || []).map(c =>
    `<span class="color-swatch" style="background:${getColorHex(c)}" title="${escHtml(c)}"></span>`
  ).join('');

  const sizes = (p.sizes || []).join(' · ');

  return `
    <div class="product-card">
      ${img}
      <div class="product-card-body">
        <h4>${escHtml(p.name)}</h4>
        <div class="product-meta">
          <span>Colors: <strong>${p.colors?.length || 0}</strong></span>
          <span>Sizes: <strong>${p.sizes?.length || 0}</strong></span>
        </div>
        <div class="tags-container">
          ${colors}
          ${sizes ? `<span style="font-size:9px;color:rgba(255,255,255,0.4);letter-spacing:1.5px;text-transform:uppercase;margin-left:4px;">${sizes}</span>` : ''}
        </div>
        <div class="product-card-actions">
          <button class="btn btn-ghost btn-sm" onclick="openEditProductModal('${p.id}')">✎ Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteProduct('${p.id}')">✕ Delete</button>
        </div>
      </div>
    </div>
  `;
}

// ── Add / Edit Product Modal ──
function openAddProductModal() {
  openProductModal(null);
}

function openEditProductModal(id) {
  const p = State.products.find(x => x.id === id);
  if (!p) return;
  openProductModal(p);
}

function openProductModal(product) {
  const isEdit = !!product;
  const modal = document.getElementById('modalOverlay');
  const title = isEdit ? 'Edit Product' : 'Add Product';

  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = `
    <div class="form-group">
      <label class="form-label">Product Name</label>
      <input class="form-input" id="modalProductName" placeholder="e.g. Ye Onyx Oversized T-Shirt" value="${escHtml(product?.name || '')}">
    </div>
    <div class="form-group">
      <label class="form-label">Image URL (optional)</label>
      <input class="form-input" id="modalProductImage" placeholder="https://..." value="${escHtml(product?.image || '')}">
    </div>
    <div class="form-group">
      <label class="form-label">Sizes (press Enter to add)</label>
      <div class="tags-container" id="modalSizeTags">
        ${(product?.sizes || []).map(s => `<span class="tag">${escHtml(s)}<span class="tag-remove" onclick="removeModalTag(this)">×</span></span>`).join('')}
        <span class="tag-add-input">
          <input id="modalSizeInput" placeholder="Size" onkeydown="handleTagInput(event, 'size')">
        </span>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Colors (press Enter to add)</label>
      <div class="tags-container" id="modalColorTags">
        ${(product?.colors || []).map(c => `<span class="tag"><span class="color-swatch" style="background:${getColorHex(c)}"></span>${escHtml(c)}<span class="tag-remove" onclick="removeModalTag(this)">×</span></span>`).join('')}
        <span class="tag-add-input">
          <input id="modalColorInput" placeholder="Color" onkeydown="handleTagInput(event, 'color')">
        </span>
      </div>
    </div>
  `;

  document.getElementById('modalFooter').innerHTML = `
    <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveProduct('${product?.id || ''}')">${isEdit ? 'Update' : 'Add'}</button>
  `;

  modal.classList.add('active');
}

function handleTagInput(e, type) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const val = e.target.value.trim();
  if (!val) return;

  const containerId = type === 'size' ? 'modalSizeTags' : 'modalColorTags';
  const container = document.getElementById(containerId);
  const inputSpan = container.querySelector('.tag-add-input');

  const swatch = type === 'color' ? `<span class="color-swatch" style="background:${getColorHex(val)}"></span>` : '';
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.innerHTML = `${swatch}${escHtml(val)}<span class="tag-remove" onclick="removeModalTag(this)">×</span>`;
  container.insertBefore(tag, inputSpan);
  e.target.value = '';
}

function removeModalTag(el) {
  el.parentElement.remove();
}

function getModalTags(containerId) {
  const tags = document.querySelectorAll(`#${containerId} .tag`);
  return Array.from(tags).map(t => {
    const clone = t.cloneNode(true);
    clone.querySelector('.tag-remove')?.remove();
    clone.querySelector('.color-swatch')?.remove();
    return clone.textContent.trim();
  });
}

function saveProduct(existingId) {
  const name = document.getElementById('modalProductName').value.trim();
  if (!name) { toast('Product name is required', 'error'); return; }

  const image = document.getElementById('modalProductImage').value.trim();
  const sizes = getModalTags('modalSizeTags');
  const colors = getModalTags('modalColorTags');

  if (existingId) {
    const p = State.products.find(x => x.id === existingId);
    if (p) {
      p.name = name;
      p.image = image;
      p.sizes = sizes;
      p.colors = colors;
      toast('Product updated', 'success');
    }
  } else {
    State.products.push({ id: genId(), name, image, sizes, colors });
    toast('Product added', 'success');
  }

  save();
  closeModal();
  renderProducts();
}

function deleteProduct(id) {
  if (!confirm('Delete this product?')) return;
  State.products = State.products.filter(p => p.id !== id);
  save();
  renderProducts();
  toast('Product deleted');
}

// ══════════════════════════════
//  LOTS PAGE
// ══════════════════════════════

function renderLots() {
  const container = document.getElementById('lotsContent');

  const totalLots = State.lots.length;
  const openLots = State.lots.filter(l => getLotTotal(l) < l.maxItems).length;
  const fullLots = totalLots - openLots;
  const totalItems = State.lots.reduce((sum, l) => sum + getLotTotal(l), 0);

  document.getElementById('lotsStats').innerHTML = `
    <div class="stat-card">
      <span class="stat-label">Total Lots</span>
      <span class="stat-value">${totalLots}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">Open</span>
      <span class="stat-value">${openLots}</span>
      <span class="stat-sub">accepting items</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">Full</span>
      <span class="stat-value">${fullLots}</span>
      <span class="stat-sub">at capacity</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">Total Items</span>
      <span class="stat-value">${totalItems}</span>
      <span class="stat-sub">across all lots</span>
    </div>
  `;

  if (totalLots === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <h3>No Lots Created</h3>
        <p>Create a lot to start adding product variants with a maximum item limit.</p>
        <button class="btn btn-primary" onclick="openCreateLotModal()">+ Create Lot</button>
      </div>
    `;
    return;
  }

  container.innerHTML = `<div class="lot-grid">${State.lots.map(l => renderLotCard(l)).join('')}</div>`;
}

function getLotTotal(lot) {
  return (lot.items || []).reduce((sum, i) => sum + i.qty, 0);
}

function renderLotCard(lot) {
  const total = getLotTotal(lot);
  const pct = Math.min((total / lot.maxItems) * 100, 100);
  const barClass = pct >= 100 ? 'full' : pct >= 80 ? 'warning' : '';
  const statusClass = pct >= 100 ? 'full' : 'open';
  const statusLabel = pct >= 100 ? 'Full' : 'Available';

  let itemsHtml = '';
  if (lot.items && lot.items.length > 0) {
    itemsHtml = lot.items.map(item => `
      <div class="lot-item">
        <span class="lot-item-name">${escHtml(item.productName)}</span>
        <span class="lot-item-variant">${escHtml(item.color)} / ${escHtml(item.size)}</span>
        <div class="lot-item-qty">
          <input type="number" min="1" value="${item.qty}" 
                 onchange="updateLotItemQty('${lot.id}','${item.id}', this.value)">
          <button class="btn-icon btn btn-sm" onclick="removeLotItem('${lot.id}','${item.id}')" title="Remove">✕</button>
        </div>
      </div>
    `).join('');
  } else {
    itemsHtml = '<div style="text-align:center;padding:24px;color:rgba(255,255,255,0.2);font-size:9px;text-transform:uppercase;letter-spacing:2.25px;">No items added</div>';
  }

  const productOptions = State.products.map(p =>
    `<option value="${p.id}">${escHtml(p.name)}</option>`
  ).join('');

  const canAdd = total < lot.maxItems;

  return `
    <div class="lot-card">
      <div class="lot-card-header">
        <div>
          <h3>${escHtml(lot.name)}</h3>
          <div class="lot-id">ID: ${lot.id.toUpperCase()}</div>
        </div>
        <span class="lot-status ${statusClass}">${statusLabel}</span>
      </div>
      <div class="lot-progress">
        <div class="progress-bar-container">
          <div class="progress-bar-fill ${barClass}" style="width:${pct}%"></div>
        </div>
        <div class="progress-info">
          <span class="current">${total} items</span>
          <span class="max">/ ${lot.maxItems} max</span>
        </div>
      </div>
      <div class="lot-items">
        ${itemsHtml}
      </div>
      ${canAdd ? `
      <div class="add-to-lot-section" style="text-align: center;">
        <button class="btn btn-primary" onclick="openQuickAddModal('${lot.id}')" style="width: 100%; justify-content: center; padding: 12px; font-size: 11px;">+ Quick Add Items</button>
      </div>
      ` : ''}
      <div class="lot-card-footer">
        <button class="btn btn-ghost btn-sm" onclick="viewLotSummary('${lot.id}')">📊 Summary</button>
        <button class="btn btn-danger btn-sm" onclick="deleteLot('${lot.id}')">✕ Delete</button>
      </div>
    </div>
  `;
}

/* Quick Add Logic */
function openQuickAddModal(lotId) {
  const lot = State.lots.find(l => l.id === lotId);
  if (!lot) return;

  const modal = document.getElementById('modalOverlay');
  document.getElementById('modalTitle').textContent = `Quick Add to ${lot.name}`;
  
  const renderProductList = (searchQuery = '') => {
    let html = '';
    const filtered = State.products.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()));
    
    if (filtered.length === 0) {
      return '<div style="color:var(--text-muted);text-align:center;padding:20px;font-size:11px;">No products found</div>';
    }

    filtered.forEach(p => {
      let variantHtml = '';
      const colors = p.colors && p.colors.length ? p.colors : ['Default'];
      const sizes = p.sizes && p.sizes.length ? p.sizes : ['One Size'];
      
      colors.forEach(c => {
        sizes.forEach(s => {
          variantHtml += `
            <div class="variant-item">
              <div class="variant-item-label">
                ${c !== 'Default' ? `<span class="color-swatch" style="background:${getColorHex(c)}"></span>` : ''}
                ${c !== 'Default' ? escHtml(c) + ' / ' : ''}${escHtml(s)}
              </div>
              <div class="qty-input-group">
                <input type="number" class="form-input" min="0" placeholder="0" 
                       data-product-id="${p.id}" data-color="${escHtml(c)}" data-size="${escHtml(s)}">
              </div>
            </div>
          `;
        });
      });
      
      if (variantHtml) {
        html += `
          <div class="quick-add-product">
            <h4>${escHtml(p.name)}</h4>
            <div class="variant-grid">
              ${variantHtml}
            </div>
          </div>
        `;
      }
    });
    return html;
  };

  document.getElementById('modalBody').innerHTML = `
    <div class="form-group quick-add-search">
      <div class="search-bar" style="max-width: none;">
        <span class="search-icon">⌕</span>
        <input id="quickAddSearch" placeholder="Search products...">
      </div>
    </div>
    <div class="quick-add-list" id="quickAddList">
      ${renderProductList()}
    </div>
  `;

  document.getElementById('modalFooter').innerHTML = `
    <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="addBatchToLot('${lot.id}')">Add to Lot</button>
  `;

  // Attach search event
  setTimeout(() => {
    const searchInput = document.getElementById('quickAddSearch');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        document.getElementById('quickAddList').innerHTML = renderProductList(e.target.value);
      });
      searchInput.focus();
    }
  }, 50);

  modal.classList.add('active');
}

function addBatchToLot(lotId) {
  const lot = State.lots.find(l => l.id === lotId);
  if (!lot) return;

  const inputs = document.querySelectorAll('#quickAddList input[type="number"]');
  let addedCount = 0;
  let totalAdding = 0;
  
  // First, calculate total items being added
  const itemsToAdd = [];
  inputs.forEach(input => {
    const qty = parseInt(input.value);
    if (qty > 0) {
      totalAdding += qty;
      itemsToAdd.push({
        productId: input.dataset.productId,
        color: input.dataset.color,
        size: input.dataset.size,
        qty: qty
      });
    }
  });

  if (totalAdding === 0) {
    toast('No items selected', 'error');
    return;
  }

  const currentTotal = getLotTotal(lot);
  if (currentTotal + totalAdding > lot.maxItems) {
    toast(`Cannot add ${totalAdding} items. Max limit exceeded!`, 'error');
    return;
  }

  // Iterate and add
  itemsToAdd.forEach(item => {
    const product = State.products.find(p => p.id === item.productId);
    if (!product) return;
    
    const existing = lot.items.find(i =>
      i.productId === item.productId && i.color === item.color && i.size === item.size
    );

    if (existing) {
      existing.qty += item.qty;
    } else {
      lot.items.push({
        id: genId(),
        productId: item.productId,
        productName: product.name,
        color: item.color,
        size: item.size,
        qty: item.qty,
      });
    }
    addedCount += item.qty;
  });

  if (addedCount > 0) {
    toast(`Added ${addedCount} items to lot`, 'success');
    save();
    renderLots();
    closeModal();
  }
}

function updateLotItemQty(lotId, itemId, val) {
  const lot = State.lots.find(l => l.id === lotId);
  if (!lot) return;

  const item = lot.items.find(i => i.id === itemId);
  if (!item) return;

  const newQty = parseInt(val) || 1;
  const totalWithout = getLotTotal(lot) - item.qty;

  if (totalWithout + newQty > lot.maxItems) {
    toast(`Max ${lot.maxItems - totalWithout} for this item`, 'error');
    renderLots();
    return;
  }

  item.qty = newQty;
  save();
  renderLots();
}

function removeLotItem(lotId, itemId) {
  const lot = State.lots.find(l => l.id === lotId);
  if (!lot) return;
  lot.items = lot.items.filter(i => i.id !== itemId);
  save();
  renderLots();
  toast('Item removed');
}

function openCreateLotModal() {
  const modal = document.getElementById('modalOverlay');
  document.getElementById('modalTitle').textContent = 'Create Lot';
  document.getElementById('modalBody').innerHTML = `
    <div class="form-group">
      <label class="form-label">Lot Name</label>
      <input class="form-input" id="modalLotName" placeholder="e.g. Spring Collection Batch 1">
    </div>
    <div class="form-group">
      <label class="form-label">Max Items (Lot Limit)</label>
      <input class="form-input" type="number" id="modalLotMax" placeholder="e.g. 500" min="1">
    </div>
  `;
  document.getElementById('modalFooter').innerHTML = `
    <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="createLot()">Create</button>
  `;
  modal.classList.add('active');
}

function createLot() {
  const name = document.getElementById('modalLotName').value.trim();
  const max = parseInt(document.getElementById('modalLotMax').value);

  if (!name) { toast('Lot name is required', 'error'); return; }
  if (!max || max < 1) { toast('Max items must be at least 1', 'error'); return; }

  State.lots.push({
    id: genId(),
    name,
    maxItems: max,
    items: [],
    createdAt: new Date().toISOString(),
  });

  save();
  closeModal();
  renderLots();
  toast(`Lot "${name}" created`, 'success');
}

function deleteLot(id) {
  if (!confirm('Delete this lot and all its items?')) return;
  State.lots = State.lots.filter(l => l.id !== id);
  save();
  renderLots();
  toast('Lot deleted');
}

function viewLotSummary(lotId) {
  const lot = State.lots.find(l => l.id === lotId);
  if (!lot) return;

  const modal = document.getElementById('modalOverlay');
  document.getElementById('modalTitle').textContent = lot.name;

  const grouped = {};
  (lot.items || []).forEach(item => {
    if (!grouped[item.productName]) grouped[item.productName] = [];
    grouped[item.productName].push(item);
  });

  let contentHtml = '';
  // Check if empty
  if (Object.keys(grouped).length === 0) {
    contentHtml = '<div style="text-align:center;padding:32px;color:rgba(255,255,255,0.2);font-size:11px;text-transform:uppercase;letter-spacing:2px;">Lot is currently empty</div>';
  } else {
    Object.entries(grouped).forEach(([productName, items]) => {
      const productTotal = items.reduce((s, i) => s + i.qty, 0);
      contentHtml += `
        <div class="summary-product-group">
          <div class="summary-product-header">
            <h4>${escHtml(productName)}</h4>
            <div class="summary-product-total">Total: ${productTotal}</div>
          </div>
          <div class="summary-variant-list">
      `;
      items.forEach(item => {
        contentHtml += `
          <div class="summary-variant-row">
            <div class="summary-variant-info">
              <span class="color-swatch" style="background:${getColorHex(item.color)}"></span>
              <span>${escHtml(item.color)}</span>
              <span style="color:var(--text-muted);">|</span>
              <span>${escHtml(item.size)}</span>
            </div>
            <div class="summary-variant-qty">${item.qty}</div>
          </div>
        `;
      });
      contentHtml += `
          </div>
        </div>
      `;
    });
  }

  const total = getLotTotal(lot);
  const pct = Math.min((total / lot.maxItems) * 100, 100);

  document.getElementById('modalBody').innerHTML = `
    <div id="exportSummaryContainer" class="summary-export-container">
      <div style="margin-bottom:24px;">
        <h2 style="font-size:22px; font-weight:900; color:var(--text-heading); text-transform:uppercase; letter-spacing:1px; margin-bottom:12px;">
          ${escHtml(lot.name)} <span style="font-size:10px; color:var(--text-muted); font-weight:400; letter-spacing:1.5px; margin-left:8px;">${lot.id.toUpperCase()}</span>
        </h2>
        <div class="progress-bar-container">
          <div class="progress-bar-fill ${pct >= 100 ? 'full' : pct >= 80 ? 'warning' : ''}" style="width:${pct}%"></div>
        </div>
        <div class="progress-info" style="margin-top:8px;">
          <span class="current">${total} items</span>
          <span class="max">/ ${lot.maxItems} max capacity</span>
        </div>
      </div>
      <div>
        ${contentHtml}
      </div>
    </div>
  `;

  document.getElementById('modalFooter').innerHTML = `
    <button class="btn btn-ghost summary-export-btn" onclick="exportLotSummary('${lot.id}', '${escHtml(lot.name)}')">↓ Export as PNG</button>
    <button class="btn btn-primary" onclick="closeModal()">Close</button>
  `;
  modal.classList.add('active');
}

function exportLotSummary(lotId, lotName) {
  const container = document.getElementById('exportSummaryContainer');
  if (!container) return;
  
  const btn = document.querySelector('.summary-export-btn');
  if (btn) {
    btn.textContent = 'Preparing...';
    btn.disabled = true;
  }

  // Ensure html2canvas is loaded
  if (typeof html2canvas === 'undefined') {
    toast('Export library loading... Try again in a moment.', 'warning');
    if (btn) {
      btn.textContent = '↓ Export as PNG';
      btn.disabled = false;
    }
    return;
  }

  // Create an explicit background div behind it so the export is dark themed properly.
  // Using the root background color gives best result.
  html2canvas(container, {
    backgroundColor: '#090909',
    scale: 2, 
    useCORS: true
  }).then(canvas => {
    const link = document.createElement('a');
    link.download = `lot-${lotName.replace(/\s+/g, '-').toLowerCase()}-summary.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    toast('Summary exported successfully!', 'success');
  }).catch(err => {
    console.error('Export failed:', err);
    toast('Export failed', 'error');
  }).finally(() => {
    if (btn) {
      btn.textContent = '↓ Export as PNG';
      btn.disabled = false;
    }
  });
}

// ══════════════════════════════
//  SETTINGS PAGE
// ══════════════════════════════

function renderSettings() {
  const container = document.getElementById('settingsContent');
  container.innerHTML = `
    <div class="settings-section">
      <div class="glass-card">
        <div class="glass-card-header">
          <h3>Shopify Store</h3>
        </div>
        <div class="form-group">
          <label class="form-label">Store URL</label>
          <input class="form-input" id="settingsStoreUrl" value="${escHtml(State.storeUrl)}" placeholder="https://your-store.myshopify.com">
        </div>
        <div class="form-group">
          <label class="form-label">Auto-Sync Interval (Minutes)</label>
          <input class="form-input" type="number" id="settingsSyncInterval" value="${State.syncInterval}" min="1" max="60" style="max-width:120px;">
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
          <button class="btn btn-primary" onclick="saveSettings()">Save</button>
          <button class="btn btn-ghost" onclick="syncNow()">⟳ Sync Now</button>
        </div>
        <div style="margin-top:12px;font-size:9px;color:rgba(255,255,255,0.25);letter-spacing:1px;text-transform:uppercase;">
          ${State.lastSync ? `Last synced: ${new Date(State.lastSync).toLocaleString()}` : 'Not synced yet'}
        </div>
      </div>

      <div class="glass-card">
        <div class="glass-card-header">
          <h3>Data Management</h3>
        </div>
        <div class="data-actions" style="margin-top:0;padding-top:0;border-top:none;">
          <button class="btn btn-ghost" onclick="exportData()">↓ Export</button>
          <button class="btn btn-ghost" onclick="document.getElementById('importFile').click()">↑ Import</button>
          <input type="file" id="importFile" accept=".json" style="display:none" onchange="importData(event)">
        </div>
      </div>

      <div class="glass-card">
        <div class="glass-card-header">
          <h3>Danger Zone</h3>
        </div>
        <button class="btn btn-danger" onclick="clearAllData()">Clear All Data</button>
      </div>
    </div>
  `;
}

function saveSettings() {
  const url = document.getElementById('settingsStoreUrl').value.trim();
  const interval = parseInt(document.getElementById('settingsSyncInterval').value) || 5;

  if (!url) { toast('URL is required', 'error'); return; }

  State.storeUrl = url;
  State.syncInterval = Math.max(1, Math.min(60, interval));
  save();
  startAutoSync(); // restart with new interval
  toast('Settings saved', 'success');
}

// ── Data Export / Import ──
function exportData() {
  const blob = new Blob([JSON.stringify({ products: State.products, lots: State.lots, storeUrl: State.storeUrl }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lot-counter-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Data exported', 'success');
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.products) State.products = data.products;
      if (data.lots) State.lots = data.lots;
      if (data.storeUrl) State.storeUrl = data.storeUrl;
      save();
      renderCurrentPage();
      toast('Data imported', 'success');
    } catch (err) {
      toast('Invalid JSON file', 'error');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function clearAllData() {
  if (!confirm('Delete ALL products and lots permanently?')) return;
  if (!confirm('Are you absolutely sure?')) return;
  State.products = [];
  State.lots = [];
  State.lastSync = null;
  save();
  renderCurrentPage();
  toast('All data cleared');
}

// ── Modal helpers ──
function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
}

function escHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ══════════════════════════════
//  BACKGROUND ANIMATION
//  (Raptile Studio connect-the-dots)
// ══════════════════════════════

function initBackground() {
  const canvas = document.getElementById('bgCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let w, h;
  const particles = [];
  const PARTICLE_COUNT = 60;
  const MAX_DIST = 140;

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }

  function createParticles() {
    particles.length = 0;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        r: Math.random() * 1.5 + 0.5,
      });
    }
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);

    // Update positions
    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = w;
      if (p.x > w) p.x = 0;
      if (p.y < 0) p.y = h;
      if (p.y > h) p.y = 0;
    });

    // Draw connections
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MAX_DIST) {
          const alpha = (1 - dist / MAX_DIST) * 0.12;
          ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.stroke();
        }
      }
    }

    // Draw particles
    particles.forEach(p => {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    });

    requestAnimationFrame(draw);
  }

  resize();
  createParticles();
  draw();
  window.addEventListener('resize', () => {
    resize();
    createParticles();
  });
}

// ══════════════════════════════
//  INIT
// ══════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  load();
  initBackground();

  // Nav clicks
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => navigate(item.dataset.page));
  });

  // Mobile menu
  document.querySelector('.mobile-menu-btn')?.addEventListener('click', () => {
    document.querySelector('.sidebar').classList.toggle('open');
  });

  // Close modal on overlay click
  document.getElementById('modalOverlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });

  // Close modal on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });

  // Product search
  document.getElementById('productSearch')?.addEventListener('input', () => renderProducts());

  // Sidebar sync button
  document.querySelector('.sync-btn')?.addEventListener('click', () => syncNow());

  // Initial render
  navigate('products');

  // Start auto-sync
  startAutoSync();
});
