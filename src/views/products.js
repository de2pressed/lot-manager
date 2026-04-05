import { state } from '../state.js';
import { hasRole, requireCurrentUser } from '../utils/access.js';
import { $, $$ } from '../utils/dom.js';
import { escapeHtml, formatDateTime } from '../utils/format.js';
import { buildVariantTitle, getProductVariants } from '../utils/products.js';
import { confirmModal, isModalOpen, openModal } from '../ui/modal.js';
import { showToast } from '../ui/toast.js';
import {
  createProduct,
  deleteProduct,
  updateProduct
} from '../services/products.service.js';

let searchTerm = '';

function productMatches(product) {
  const haystack = `${product.title} ${JSON.stringify(product.variants || [])}`.toLowerCase();
  return haystack.includes(searchTerm.toLowerCase());
}

function renderVariantRows(variants) {
  return variants
    .map(
      (variant) => `
        <div class="variant-editor-row">
          <input placeholder="Variant title" data-variant-field="title" value="${escapeHtml(
            variant.title || ''
          )}" />
          <input placeholder="SKU" data-variant-field="sku" value="${escapeHtml(variant.sku || '')}" />
          <input placeholder="Price" type="number" min="0" step="0.01" data-variant-field="price" value="${escapeHtml(
            variant.price ?? ''
          )}" />
          <input placeholder="Color" data-variant-field="color" value="${escapeHtml(
            variant.color || ''
          )}" />
          <input placeholder="Size" data-variant-field="size" value="${escapeHtml(variant.size || '')}" />
          <button class="button button-ghost button-small" type="button" data-remove-variant>Remove</button>
        </div>
      `
    )
    .join('');
}

function collectVariants(bodyTarget) {
  const variants = $$('.variant-editor-row', bodyTarget)
    .map((row) => ({
      title: $('[data-variant-field="title"]', row)?.value.trim() || '',
      sku: $('[data-variant-field="sku"]', row)?.value.trim() || '',
      price: Number($('[data-variant-field="price"]', row)?.value || 0),
      color: $('[data-variant-field="color"]', row)?.value.trim() || null,
      size: $('[data-variant-field="size"]', row)?.value.trim() || null
    }))
    .filter(
      (variant) =>
        variant.title || variant.sku || variant.price || variant.color || variant.size
    );

  return variants.length
    ? variants.map((variant) => ({
        ...variant,
        title: variant.title || buildVariantTitle(variant)
      }))
    : [{ title: 'Default', sku: '', price: 0, color: null, size: null }];
}

function openProductModal(product = null) {
  const body = document.createElement('div');
  const footer = document.createElement('div');
  const initialVariants = getProductVariants(product);

  body.innerHTML = `
    <form class="modal-form" id="product-form">
      <div class="field-grid">
        <label class="field full">
          <span>Product Title</span>
          <input id="product-title" value="${escapeHtml(product?.title || '')}" required />
        </label>
        <label class="field full">
          <span>Image URL</span>
          <input id="product-image" value="${escapeHtml(product?.image_url || '')}" placeholder="https://..." />
        </label>
      </div>
      <div class="variant-editor-head">
        <div>
          <h3>Variants</h3>
          <p>Add Shopify-like variant rows for size, color, and SKU data.</p>
        </div>
        <button class="button button-secondary button-small" type="button" id="add-variant-row">Add Variant</button>
      </div>
      <div id="variant-rows" class="variant-editor-list">
        ${renderVariantRows(initialVariants)}
      </div>
    </form>
  `;

  footer.innerHTML = `
    <button class="button button-secondary" type="button" data-close-modal>Cancel</button>
    <button class="button button-primary" type="submit" form="product-form">${product ? 'Update Product' : 'Create Product'}</button>
  `;

  openModal({
    title: product ? 'Edit Product' : 'Add Product',
    description: 'Manual products sit alongside the synced Shopify catalog.',
    body,
    footer,
    onOpen({ body: bodyTarget, close }) {
      const variantRows = $('#variant-rows', bodyTarget);

      $('#add-variant-row', bodyTarget)?.addEventListener('click', () => {
        variantRows.insertAdjacentHTML(
          'beforeend',
          renderVariantRows([{ title: '', sku: '', price: '', color: '', size: '' }])
        );
      });

      bodyTarget.addEventListener('click', (event) => {
        if (event.target.closest('[data-remove-variant]')) {
          event.target.closest('.variant-editor-row')?.remove();
        }
      });

      $('#product-form', bodyTarget)?.addEventListener('submit', async (event) => {
        event.preventDefault();

        try {
          const userId = requireCurrentUser();
          if (!userId) return;

          const payload = {
            title: $('#product-title', bodyTarget).value.trim(),
            image_url: $('#product-image', bodyTarget).value.trim() || null,
            variants: collectVariants(bodyTarget)
          };

          if (!payload.title) {
            throw new Error('Product title is required.');
          }

          if (product) {
            await updateProduct(product.id, payload, userId);
            showToast('Product updated.', 'success');
          } else {
            await createProduct(payload, userId);
            showToast('Product created.', 'success');
          }

          close('saved');
          renderProductsView(document.getElementById('view-root'));
        } catch (error) {
          showToast(error.message || 'Unable to save product.', 'error');
        }
      });
    }
  });
}

export async function renderProductsView(container) {
  if (isModalOpen()) {
    return {};
  }

  const canWrite = hasRole(['admin', 'manager']);
  const products = state.products.filter(productMatches);

  container.innerHTML = `
    <section class="page-section">
      <div class="page-header-block page-header-inline">
        <div>
          <p class="eyebrow">Catalog</p>
          <h2>Products</h2>
          <p class="page-copy">Cached Shopify catalog plus manually managed product records.</p>
        </div>
        <div class="toolbar-actions">
          <label class="toolbar-search">
            <span>Search</span>
            <input id="products-search" value="${escapeHtml(searchTerm)}" placeholder="Search products or variants" />
          </label>
          ${canWrite ? '<button class="button button-primary" id="add-product-button" type="button">Add Product</button>' : ''}
        </div>
      </div>

      ${
        products.length
          ? `
            <div class="product-grid">
              ${products
                .map((product) => {
                  const variants = getProductVariants(product);

                  return `
                    <article class="product-card">
                      <div class="product-card-media">
                        ${
                          product.image_url
                            ? `<img src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.title)}" />`
                            : '<div class="product-card-placeholder">No image</div>'
                        }
                      </div>
                      <div class="product-card-body">
                        <div class="card-row-between">
                          <h3>${escapeHtml(product.title)}</h3>
                          <span class="meta-pill">${variants.length} variants</span>
                        </div>
                        <p class="product-card-copy">
                          ${variants.slice(0, 4).map((variant) => escapeHtml(variant.title)).join(' • ')}
                        </p>
                        <div class="card-meta-line">
                          <span>Synced: ${product.synced_at ? formatDateTime(product.synced_at) : 'Manual only'}</span>
                        </div>
                        ${
                          canWrite
                            ? `
                              <div class="card-actions">
                                <button class="button button-ghost button-small" type="button" data-edit-product="${escapeHtml(product.id)}">Edit</button>
                                <button class="button button-danger button-small" type="button" data-delete-product="${escapeHtml(product.id)}">Delete</button>
                              </div>
                            `
                            : ''
                        }
                      </div>
                    </article>
                  `;
                })
                .join('')}
            </div>
          `
          : `
            <div class="empty-state-card">
              <h3>No matching products</h3>
              <p>Sync Shopify in Settings or add a manual product to start building lots.</p>
            </div>
          `
      }
    </section>
  `;

  $('#products-search', container)?.addEventListener('input', (event) => {
    searchTerm = event.target.value;
    renderProductsView(container);
  });

  $('#add-product-button', container)?.addEventListener('click', () => openProductModal());

  $$('[data-edit-product]', container).forEach((button) => {
    button.addEventListener('click', () => {
      const product = state.products.find((entry) => entry.id === button.dataset.editProduct);
      if (product) {
        openProductModal(product);
      }
    });
  });

  $$('[data-delete-product]', container).forEach((button) => {
    button.addEventListener('click', async () => {
      const product = state.products.find((entry) => entry.id === button.dataset.deleteProduct);
      if (!product) return;

      const confirmed = await confirmModal({
        title: 'Delete Product',
        body: `<p>This will remove <strong>${escapeHtml(product.title)}</strong> if nothing else still references it.</p>`,
        confirmLabel: 'Delete',
        tone: 'danger'
      });

      if (!confirmed) return;

      try {
        const userId = requireCurrentUser();
        if (!userId) return;

        await deleteProduct(product.id, userId);
        showToast('Product deleted.', 'success');
        renderProductsView(container);
      } catch (error) {
        showToast(error.message || 'Unable to delete product.', 'error');
      }
    });
  });

  return {};
}
