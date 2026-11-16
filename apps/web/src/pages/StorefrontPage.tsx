import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Minus, Plus, Search, ShoppingBag, X } from 'lucide-react';
import { ApiError, apiFetch, formatMoney } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { ProductVisual } from '../components/ProductVisual.tsx';

interface Warehouse {
  id: string;
  code: string;
  name: string;
  regionId: string;
  regionName: string;
  city: string;
  taxRate: number;
  shippingRuleType: 'flat' | 'threshold';
  shippingFlatCents: number;
  shippingFreeThresholdCents: number;
  returnWindowDays: number;
  reservationExpiryMinutes: number;
}

interface Product {
  id: string;
  sku: string;
  barcode: string;
  name: string;
  category: string;
  description: string;
  priceCents: number;
  lowStockThreshold: number;
  qtyAvailable: number;
  qtyReserved: number;
}

interface CartItem {
  product: Product;
  quantity: number;
}

export function StorefrontPage() {
  const { user, announce } = useAuth();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState('wh-central');
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);

  // Checkout state
  const [recipientName, setRecipientName] = useState('Avery Chen');
  const [line1, setLine1] = useState('100 Synthetic Way');
  const [city, setCity] = useState('Metro City');
  const [postalCode, setPostalCode] = useState('10001');
  const [phone, setPhone] = useState('+1-555-0101');
  const [syntheticCardLast4, setSyntheticCardLast4] = useState('4242');
  const [simulatedOutcome, setSimulatedOutcome] = useState<'succeed' | 'gateway_down'>('succeed');
  const [checkoutSubmitting, setCheckoutSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [checkoutResult, setCheckoutResult] = useState<{
    orderId: string;
    orderNumber: string;
    status: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    apiFetch<{ warehouses: Warehouse[] }>('/api/warehouses')
      .then((res) => {
        setWarehouses(res.warehouses);
        if (res.warehouses.length > 0 && !res.warehouses.some((w) => w.id === warehouseId)) {
          setWarehouseId(res.warehouses[0].id);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load warehouses'));
  }, []);

  const loadProducts = async (whId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ products: Product[] }>(`/api/products?warehouseId=${encodeURIComponent(whId)}`);
      setProducts(res.products);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load catalog');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProducts(warehouseId);
  }, [warehouseId]);

  const activeWarehouse = useMemo(
    () => warehouses.find((w) => w.id === warehouseId) || null,
    [warehouses, warehouseId]
  );

  const categories = useMemo(() => {
    const set = new Set<string>(['All']);
    products.forEach((p) => set.add(p.category));
    return Array.from(set);
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (category !== 'All' && p.category !== category) return false;
      if (q && !p.name.toLowerCase().includes(q) && !p.sku.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [products, category, search]);

  const addToCart = (product: Product) => {
    if (product.qtyAvailable <= 0) return;
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.product.id === product.id);
      if (idx >= 0) {
        const nextQty = Math.min(product.qtyAvailable, prev[idx].quantity + 1);
        const copy = [...prev];
        copy[idx] = { ...copy[idx], quantity: nextQty };
        return copy;
      }
      return [...prev, { product, quantity: 1 }];
    });
    announce(`Added ${product.name} to cart`);
    setCartOpen(true);
  };

  const updateCartQty = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) => {
          if (c.product.id !== productId) return c;
          const q = Math.min(c.product.qtyAvailable, c.quantity + delta);
          return q <= 0 ? null : { ...c, quantity: q };
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const cartSubtotal = cart.reduce((sum, c) => sum + c.product.priceCents * c.quantity, 0);
  const estimatedTax = activeWarehouse ? Math.round(cartSubtotal * activeWarehouse.taxRate) : 0;
  const estimatedShipping = activeWarehouse
    ? activeWarehouse.shippingRuleType === 'threshold' &&
      cartSubtotal >= activeWarehouse.shippingFreeThresholdCents
      ? 0
      : activeWarehouse.shippingFlatCents
    : 0;
  const estimatedTotal = cartSubtotal + estimatedTax + estimatedShipping;

  const handleCheckoutAndPay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cart.length === 0) return;
    setCheckoutError(null);
    setCheckoutSubmitting(true);

    try {
      const orderRes = await apiFetch<{ order: { id: string; orderNumber: string } }>('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          warehouseId,
          items: cart.map((c) => ({ productId: c.product.id, quantity: c.quantity })),
          shippingAddress: {
            recipientName,
            line1,
            city,
            postalCode,
            country: 'Synthetic Republic',
            phone,
          },
        }),
      });

      const idempotencyKey = `ui-${orderRes.order.id}-${crypto.randomUUID().slice(0, 8)}`;
      const payRes = await apiFetch<{
        orderStatus: string;
        message?: string;
      }>('/api/payments', {
        method: 'POST',
        idempotencyKey,
        body: JSON.stringify({
          orderId: orderRes.order.id,
          method: 'synthetic_card',
          syntheticCardLast4,
          simulatedOutcome,
        }),
      });

      setCheckoutResult({
        orderId: orderRes.order.id,
        orderNumber: orderRes.order.orderNumber,
        status: payRes.orderStatus,
        message:
          payRes.orderStatus === 'PAYMENT_PENDING'
            ? 'Gateway unavailable: order preserved with stock reserved as PAYMENT_PENDING for safe retry.'
            : 'Order confirmed and paid. Stock reservation consumed.',
      });
      setCart([]);
      announce(`Order ${orderRes.order.orderNumber} ${payRes.orderStatus}`);
      await loadProducts(warehouseId);
    } catch (err) {
      setCheckoutError(err instanceof ApiError ? err.message : 'Checkout failed');
    } finally {
      setCheckoutSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header & Warehouse selector */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-slate-200 pb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Omnichannel Catalogue</h1>
          <p className="mt-1 text-sm text-slate-600">
            Live warehouse stock reservations · Synthetic products and test checkout
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="wh-select" className="block text-xs font-medium text-slate-700 mb-1">
              Fulfilment Warehouse & Region
            </label>
            <select
              id="wh-select"
              value={warehouseId}
              onChange={(e) => {
                setWarehouseId(e.target.value);
                setCart([]);
              }}
              className="px-3 py-2 text-sm bg-white border border-slate-300 rounded-md min-h-[40px]"
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.regionName})
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-700 rounded-md hover:bg-blue-800 transition-colors min-h-[40px] whitespace-nowrap"
          >
            <ShoppingBag className="w-4 h-4" aria-hidden="true" />
            <span>Cart ({cart.reduce((s, c) => s + c.quantity, 0)})</span>
          </button>
        </div>
      </div>

      {/* Regional Policy Summary Line */}
      {activeWarehouse && (
        <div className="bg-white border border-slate-200 rounded-lg px-5 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-600">
          <span>
            Region: <strong className="text-slate-900">{activeWarehouse.regionName}</strong>
          </span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">
            Tax Rate: <strong className="text-slate-900">{(activeWarehouse.taxRate * 100).toFixed(1)}%</strong>
          </span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">
            Shipping:{' '}
            <strong className="text-slate-900">
              {activeWarehouse.shippingRuleType === 'threshold'
                ? `${formatMoney(activeWarehouse.shippingFlatCents)} (free over ${formatMoney(activeWarehouse.shippingFreeThresholdCents)})`
                : `${formatMoney(activeWarehouse.shippingFlatCents)} flat`}
            </strong>
          </span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">
            Return Window: <strong className="text-slate-900">{activeWarehouse.returnWindowDays} days</strong>
          </span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">
            Reservation Hold: <strong className="text-slate-900">{activeWarehouse.reservationExpiryMinutes} min</strong>
          </span>
        </div>
      )}

      {checkoutResult && (
        <div
          role="status"
          className="bg-emerald-50 border border-emerald-200 rounded-lg p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        >
          <div>
            <p className="text-sm font-semibold text-emerald-900">
              Order {checkoutResult.orderNumber} · {checkoutResult.status}
            </p>
            <p className="text-sm text-emerald-800 mt-1">{checkoutResult.message}</p>
          </div>
          <Link
            to="/orders"
            className="px-4 py-2 text-sm font-medium text-white bg-emerald-700 rounded-md hover:bg-emerald-800 whitespace-nowrap"
          >
            Track in My Orders
          </Link>
        </div>
      )}

      {/* Search and Category Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <label htmlFor="catalog-search" className="sr-only">
            Search products by name or SKU
          </label>
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input
            id="catalog-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by product name or SKU..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-md min-h-[40px]"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto" role="group" aria-label="Filter by category">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 transition-colors ${
                category === cat
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Product Grid */}
      {error && (
        <div role="alert" className="p-4 bg-red-50 border border-red-200 rounded-md text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div key={n} className="h-72 bg-white border border-slate-200 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : filteredProducts.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-12 text-center">
          <p className="text-sm text-slate-600">No products match your search criteria.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredProducts.map((p) => (
            <article
              key={p.id}
              className="bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col hover:border-slate-300 transition-colors"
            >
              <ProductVisual category={p.category} sku={p.sku} name={p.name} />
              <div className="p-5 flex-1 flex flex-col justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span>{p.category}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {p.qtyAvailable > 0 ? `${p.qtyAvailable} in stock` : 'Out of stock'}
                    </span>
                  </div>
                  <h2 className="mt-1.5 text-base font-semibold text-slate-900">{p.name}</h2>
                  <p className="mt-1 text-xs text-slate-600 line-clamp-2">{p.description}</p>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                  <span className="text-base font-semibold font-mono tabular-nums text-slate-900">
                    {formatMoney(p.priceCents)}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedProduct(p)}
                      className="px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50 min-h-[36px]"
                    >
                      Details
                    </button>
                    <button
                      type="button"
                      disabled={p.qtyAvailable <= 0}
                      onClick={() => addToCart(p)}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed min-h-[36px]"
                    >
                      {p.qtyAvailable > 0 ? 'Add to Cart' : 'Sold Out'}
                    </button>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Product Detail Modal */}
      {selectedProduct && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pdp-title"
        >
          <div className="bg-white border border-slate-200 rounded-lg max-w-lg w-full overflow-hidden">
            <ProductVisual category={selectedProduct.category} sku={selectedProduct.sku} name={selectedProduct.name} />
            <div className="p-6 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs text-slate-500">
                    {selectedProduct.category} · SKU {selectedProduct.sku} · Barcode {selectedProduct.barcode}
                  </p>
                  <h2 id="pdp-title" className="text-xl font-bold text-slate-900 mt-1">
                    {selectedProduct.name}
                  </h2>
                </div>
                <button
                  type="button"
                  aria-label="Close product details"
                  onClick={() => setSelectedProduct(null)}
                  className="p-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-sm text-slate-600">{selectedProduct.description}</p>
              <dl className="grid grid-cols-3 gap-4 py-3 border-y border-slate-200 text-xs">
                <div>
                  <dt className="text-slate-500">Unit Price</dt>
                  <dd className="mt-0.5 font-mono font-semibold text-slate-900 tabular-nums">
                    {formatMoney(selectedProduct.priceCents)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Available</dt>
                  <dd className="mt-0.5 font-mono font-semibold text-slate-900 tabular-nums">
                    {selectedProduct.qtyAvailable} units
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Reserved</dt>
                  <dd className="mt-0.5 font-mono font-semibold text-slate-900 tabular-nums">
                    {selectedProduct.qtyReserved} units
                  </dd>
                </div>
              </dl>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedProduct(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50"
                >
                  Close
                </button>
                <button
                  type="button"
                  disabled={selectedProduct.qtyAvailable <= 0}
                  onClick={() => {
                    addToCart(selectedProduct);
                    setSelectedProduct(null);
                  }}
                  className="px-4 py-2 text-sm font-semibold text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:bg-slate-300"
                >
                  Add to Cart
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cart & Checkout Drawer */}
      {cartOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex justify-end"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cart-drawer-title"
        >
          <div className="bg-white w-full max-w-md h-full overflow-y-auto p-6 flex flex-col justify-between gap-6">
            <div className="space-y-5">
              <div className="flex items-center justify-between border-b border-slate-200 pb-4">
                <h2 id="cart-drawer-title" className="text-lg font-bold text-slate-900">
                  Cart & Synthetic Checkout
                </h2>
                <button
                  type="button"
                  aria-label="Close cart drawer"
                  onClick={() => setCartOpen(false)}
                  className="p-2 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {cart.length === 0 ? (
                <p className="text-sm text-slate-600 py-8 text-center">
                  Your cart is empty. Add items from the catalogue to reserve stock at checkout.
                </p>
              ) : (
                <>
                  <ul className="divide-y divide-slate-200 border border-slate-200 rounded-md">
                    {cart.map((item) => (
                      <li key={item.product.id} className="p-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 truncate">{item.product.name}</p>
                          <p className="text-xs font-mono text-slate-500 tabular-nums">
                            {formatMoney(item.product.priceCents)} each · {item.product.qtyAvailable} avail
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            aria-label={`Decrease quantity of ${item.product.name}`}
                            onClick={() => updateCartQty(item.product.id, -1)}
                            className="p-1.5 border border-slate-300 rounded hover:bg-slate-50"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span className="w-6 text-center text-sm font-mono tabular-nums">{item.quantity}</span>
                          <button
                            type="button"
                            aria-label={`Increase quantity of ${item.product.name}`}
                            onClick={() => updateCartQty(item.product.id, 1)}
                            className="p-1.5 border border-slate-300 rounded hover:bg-slate-50"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>

                  <dl className="space-y-1.5 text-sm border-y border-slate-200 py-3">
                    <div className="flex justify-between">
                      <dt className="text-slate-600">Subtotal</dt>
                      <dd className="font-mono tabular-nums">{formatMoney(cartSubtotal)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-slate-600">Regional Tax</dt>
                      <dd className="font-mono tabular-nums">{formatMoney(estimatedTax)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-slate-600">Shipping</dt>
                      <dd className="font-mono tabular-nums">{formatMoney(estimatedShipping)}</dd>
                    </div>
                    <div className="flex justify-between font-semibold text-slate-900 pt-1.5 border-t border-slate-100">
                      <dt>Total</dt>
                      <dd className="font-mono tabular-nums">{formatMoney(estimatedTotal)}</dd>
                    </div>
                  </dl>

                  {!user ? (
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-900">
                      Please <Link to="/login" className="underline font-semibold">sign in</Link> as a customer to place and reserve an order.
                    </div>
                  ) : (
                    <form onSubmit={handleCheckoutAndPay} className="space-y-4">
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-xs font-medium text-amber-900">
                        TEST MODE: no real card data. Only synthetic test tokens and last-4 digits are accepted.
                      </div>

                      {checkoutError && (
                        <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-800">
                          {checkoutError}
                        </div>
                      )}

                      <div>
                        <label htmlFor="ship-name" className="block text-xs font-medium text-slate-700 mb-1">
                          Recipient Name
                        </label>
                        <input
                          id="ship-name"
                          required
                          value={recipientName}
                          onChange={(e) => setRecipientName(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                        />
                      </div>

                      <div>
                        <label htmlFor="ship-line1" className="block text-xs font-medium text-slate-700 mb-1">
                          Street Address
                        </label>
                        <input
                          id="ship-line1"
                          required
                          value={line1}
                          onChange={(e) => setLine1(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label htmlFor="ship-city" className="block text-xs font-medium text-slate-700 mb-1">
                            City
                          </label>
                          <input
                            id="ship-city"
                            required
                            value={city}
                            onChange={(e) => setCity(e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                          />
                        </div>
                        <div>
                          <label htmlFor="ship-zip" className="block text-xs font-medium text-slate-700 mb-1">
                            Postal Code
                          </label>
                          <input
                            id="ship-zip"
                            required
                            value={postalCode}
                            onChange={(e) => setPostalCode(e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                          />
                        </div>
                      </div>

                      <div>
                        <label htmlFor="ship-phone" className="block text-xs font-medium text-slate-700 mb-1">
                          Synthetic Phone
                        </label>
                        <input
                          id="ship-phone"
                          required
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label htmlFor="card-last4" className="block text-xs font-medium text-slate-700 mb-1">
                            Test Card Last 4
                          </label>
                          <select
                            id="card-last4"
                            value={syntheticCardLast4}
                            onChange={(e) => setSyntheticCardLast4(e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
                          >
                            <option value="4242">•••• 4242 (Synthetic Visa)</option>
                            <option value="0002">•••• 0002 (Synthetic Master)</option>
                          </select>
                        </div>
                        <div>
                          <label htmlFor="gateway-sim" className="block text-xs font-medium text-slate-700 mb-1">
                            Gateway Simulation
                          </label>
                          <select
                            id="gateway-sim"
                            value={simulatedOutcome}
                            onChange={(e) => setSimulatedOutcome(e.target.value as 'succeed' | 'gateway_down')}
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
                          >
                            <option value="succeed">Normal (Succeed)</option>
                            <option value="gateway_down">Simulate Gateway Outage</option>
                          </select>
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={checkoutSubmitting}
                        className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-60 min-h-[44px]"
                      >
                        {checkoutSubmitting
                          ? 'Reserving Stock & Processing...'
                          : `Place Order & Pay ${formatMoney(estimatedTotal)}`}
                      </button>
                    </form>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
