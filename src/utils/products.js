export function buildVariantTitle(variant = {}) {
  return (
    variant.title ||
    [variant.color, variant.size].filter(Boolean).join(' / ') ||
    'Default'
  );
}

export function getProductVariants(product) {
  if (!product?.variants?.length) {
    return [
      {
        title: 'Default',
        sku: '',
        price: 0,
        color: null,
        size: null
      }
    ];
  }

  return product.variants.map((variant) => ({
    ...variant,
    title: buildVariantTitle(variant)
  }));
}

export function findVariant(product, variantTitle) {
  return getProductVariants(product).find((variant) => variant.title === variantTitle) ?? null;
}
