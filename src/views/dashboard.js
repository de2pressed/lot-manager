import { state } from '../state.js';
import {
  escapeHtml,
  formatCurrency,
  formatDate,
  sumBy
} from '../utils/format.js';

function destroyCharts() {
  ['chart-revenue', 'chart-profit', 'chart-products', 'chart-platforms'].forEach((id) => {
    const existing = window.Chart?.getChart?.(id);
    if (existing) {
      existing.destroy();
    }
  });
}

function getMetrics() {
  const totalRevenue = sumBy(state.sales, (sale) => Number(sale.sale_price || 0) * Number(sale.qty_sold || 0));
  const totalCost = sumBy(state.sales, (sale) => Number(sale.buy_price || 0) * Number(sale.qty_sold || 0));
  const totalProfit = totalRevenue - totalCost;
  const profitMargin = totalRevenue ? (totalProfit / totalRevenue) * 100 : 0;
  const activeInventory = state.inventory.filter((item) => item.status !== 'defected');
  const unitsInStock = sumBy(
    activeInventory.filter((item) => item.status !== 'sold_out'),
    (item) => Number(item.quantity || 0)
  );
  const unitsSold = sumBy(state.sales, (sale) => Number(sale.qty_sold || 0));
  const activeLots = state.lots.filter((lot) => lot.status !== 'pushed').length;
  const lowStockAlerts = activeInventory.filter((item) => item.status === 'low_stock').length;

  return {
    totalRevenue,
    totalCost,
    totalProfit,
    profitMargin,
    unitsInStock,
    unitsSold,
    activeLots,
    lowStockAlerts
  };
}

function buildMonthlyRevenue(salesData) {
  const now = new Date();
  const buckets = [];

  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    buckets.push({
      key,
      label: date.toLocaleString('en-IN', { month: 'short', year: '2-digit' }),
      total: 0
    });
  }

  salesData.forEach((sale) => {
    const date = new Date(sale.date_sold);
    if (Number.isNaN(date.getTime())) return;

    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const bucket = buckets.find((entry) => entry.key === key);
    if (bucket) {
      bucket.total += Number(sale.sale_price || 0) * Number(sale.qty_sold || 0);
    }
  });

  return buckets;
}

function buildCumulativeProfit(salesData) {
  const sales = [...salesData].sort(
    (left, right) => new Date(left.date_sold).getTime() - new Date(right.date_sold).getTime()
  );

  let runningProfit = 0;

  return sales.map((sale) => {
    runningProfit +=
      (Number(sale.sale_price || 0) - Number(sale.buy_price || 0)) *
      Number(sale.qty_sold || 0);

    return {
      label: formatDate(sale.date_sold),
      value: runningProfit
    };
  });
}

function buildTopProducts(salesData) {
  const groups = new Map();

  salesData.forEach((sale) => {
    const key = sale.product_title || 'Unknown';
    groups.set(key, (groups.get(key) || 0) + Number(sale.qty_sold || 0));
  });

  return Array.from(groups.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 5);
}

function buildPlatformBreakdown(salesData) {
  const groups = new Map();

  salesData.forEach((sale) => {
    const key = sale.platform || 'Direct';
    groups.set(key, (groups.get(key) || 0) + Number(sale.qty_sold || 0));
  });

  return Array.from(groups.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value);
}

function getDoughnutColors(count) {
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) {
      return 'rgba(0, 230, 118, 0.80)';
    }

    const opacity = Math.max(0.04, 0.20 - (index - 1) * 0.06);
    return `rgba(255, 255, 255, ${opacity.toFixed(2)})`;
  });
}

function initCharts(salesData) {
  if (!window.Chart) {
    return;
  }

  destroyCharts();

  window.Chart.defaults.font.family = "'DM Sans', system-ui, sans-serif";
  window.Chart.defaults.font.size = 10;
  window.Chart.defaults.color = 'rgba(255, 255, 255, 0.25)';
  window.Chart.defaults.layout = window.Chart.defaults.layout || {};
  window.Chart.defaults.layout.padding = 0;

  const monthlyRevenue = buildMonthlyRevenue(salesData);
  const cumulativeProfit = buildCumulativeProfit(salesData);
  const topProducts = buildTopProducts(salesData);
  const platformBreakdown = buildPlatformBreakdown(salesData);
  const sharedTooltip = {
    backgroundColor: 'rgba(10,10,10,0.92)',
    borderColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    titleColor: '#f0f0f0',
    bodyColor: 'rgba(255,255,255,0.5)',
    padding: 10,
    cornerRadius: 10,
    displayColors: false,
    titleFont: {
      family: "'DM Sans', system-ui, sans-serif",
      size: 11,
      weight: '700'
    },
    bodyFont: {
      family: "'DM Sans', system-ui, sans-serif",
      size: 11
    }
  };

  const revenueCanvas = document.getElementById('chart-revenue');
  if (revenueCanvas) {
    const totalRevenue = monthlyRevenue.reduce((sum, entry) => sum + entry.total, 0);
    const revenueHeadline = document.getElementById('revenue-headline');
    if (revenueHeadline) {
      revenueHeadline.textContent = formatCurrency(totalRevenue);
    }

    new window.Chart(revenueCanvas, {
      type: 'bar',
      data: {
        labels: monthlyRevenue.map((entry) => entry.label),
        datasets: [
          {
            label: 'Revenue',
            data: monthlyRevenue.map((entry) => entry.total),
            backgroundColor: 'rgba(0, 230, 118, 0.12)',
            borderColor: 'rgba(0, 230, 118, 0.70)',
            borderWidth: 1.5,
            borderRadius: 6,
            borderSkipped: false,
            barThickness: 22
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            ...sharedTooltip,
            callbacks: {
              label: (ctx) => formatCurrency(ctx.parsed.y)
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: {
              color: 'rgba(255, 255, 255, 0.25)',
              font: { size: 9 },
              maxRotation: 0
            }
          },
          y: {
            display: false
          }
        }
      }
    });
  }

  const profitCanvas = document.getElementById('chart-profit');
  if (profitCanvas) {
    const totalProfit = cumulativeProfit.at(-1)?.value ?? 0;
    const profitHeadline = document.getElementById('profit-headline');
    if (profitHeadline) {
      profitHeadline.textContent = formatCurrency(totalProfit);
    }

    const profitContext = profitCanvas.getContext('2d');
    const gradientFill = profitContext
      ? (() => {
          const gradient = profitContext.createLinearGradient(0, 0, 0, 140);
          gradient.addColorStop(0, 'rgba(0, 230, 118, 0.18)');
          gradient.addColorStop(1, 'rgba(0, 230, 118, 0)');
          return gradient;
        })()
      : 'rgba(0, 230, 118, 0.18)';

    new window.Chart(profitCanvas, {
      type: 'line',
      data: {
        labels: cumulativeProfit.map((entry) => entry.label),
        datasets: [
          {
            label: 'Profit',
            data: cumulativeProfit.map((entry) => entry.value),
            borderColor: '#00e676',
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 3,
            pointBackgroundColor: '#00e676',
            pointBorderColor: '#080808',
            pointBorderWidth: 1.5,
            tension: 0.4,
            fill: true,
            backgroundColor: gradientFill
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            ...sharedTooltip,
            callbacks: {
              label: (ctx) => formatCurrency(ctx.parsed.y)
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: {
              color: 'rgba(255, 255, 255, 0.25)',
              font: { size: 9 },
              maxRotation: 45,
              maxTicksLimit: 6
            }
          },
          y: {
            display: false
          }
        }
      }
    });
  }

  const productsCanvas = document.getElementById('chart-products');
  if (productsCanvas) {
    new window.Chart(productsCanvas, {
      type: 'bar',
      data: {
        labels: topProducts.map((entry) =>
          entry.label.length > 22 ? `${entry.label.slice(0, 22)}...` : entry.label
        ),
        datasets: [
          {
            label: 'Units Sold',
            data: topProducts.map((entry) => entry.value),
            backgroundColor: 'rgba(255, 255, 255, 0.06)',
            borderColor: 'rgba(255, 255, 255, 0.18)',
            borderWidth: 1,
            borderRadius: 4,
            borderSkipped: false,
            barThickness: 16
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: {
          legend: { display: false },
          tooltip: {
            ...sharedTooltip
          }
        },
        scales: {
          x: {
            display: false
          },
          y: {
            grid: { display: false },
            border: { display: false },
            ticks: {
              color: 'rgba(255, 255, 255, 0.35)',
              font: { size: 10 }
            }
          }
        }
      }
    });
  }

  const platformsCanvas = document.getElementById('chart-platforms');
  if (platformsCanvas) {
    const labels = platformBreakdown.map((entry) => entry.label);
    const data = platformBreakdown.map((entry) => entry.value);
    const total = data.reduce((sum, value) => sum + value, 0);
    const colors = getDoughnutColors(labels.length);

    new window.Chart(platformsCanvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [
          {
            data,
            backgroundColor: colors,
            borderColor: '#080808',
            borderWidth: 3,
            hoverOffset: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '76%',
        plugins: {
          legend: { display: false },
          tooltip: {
            ...sharedTooltip,
            callbacks: {
              label: (ctx) => {
                const value = Number(ctx.parsed || 0);
                const pct = total ? Math.round((value / total) * 100) : 0;
                return `${ctx.label}: ${value} (${pct}%)`;
              }
            }
          }
        }
      }
    });

    const legendEl = document.getElementById('platform-legend');
    if (legendEl) {
      legendEl.innerHTML = platformBreakdown.length
        ? platformBreakdown
            .map((entry, index) => {
              const pct = total ? Math.round((entry.value / total) * 100) : 0;
              return `
                <div class="chart-donut-legend-row">
                  <span class="chart-donut-legend-dot" style="background:${colors[index]}"></span>
                  <span class="chart-donut-legend-name">${escapeHtml(entry.label)}</span>
                  <span class="chart-donut-legend-pct">${pct}%</span>
                </div>
              `;
            })
            .join('')
        : `
            <div class="chart-donut-legend-row">
              <span class="chart-donut-legend-name">No sales yet</span>
              <span class="chart-donut-legend-pct">0%</span>
            </div>
          `;
    }
  }
}

function metricCard(label, value, tone = '') {
  return `
    <article class="metric-card stat-card ${tone}">
      <span class="stat-label">${label}</span>
      <strong class="stat-value">${value}</strong>
    </article>
  `;
}

export async function renderDashboardView(container) {
  const metrics = getMetrics();

  container.innerHTML = `
    <section class="page-section">
      <div class="page-header-block">
        <div>
          <p class="eyebrow">Overview</p>
          <h2>Dashboard</h2>
          <p class="page-copy">Live inventory, lot, and sales health across the team workspace.</p>
        </div>
      </div>

      <div class="stats-grid">
        ${metricCard('Revenue', formatCurrency(metrics.totalRevenue))}
        ${metricCard('Cost', formatCurrency(metrics.totalCost))}
        ${metricCard('Profit', formatCurrency(metrics.totalProfit), 'success')}
        ${metricCard('Margin', `${metrics.profitMargin.toFixed(1)}%`)}
        ${metricCard('Units In Stock', `${metrics.unitsInStock}`)}
        ${metricCard('Units Sold', `${metrics.unitsSold}`)}
        ${metricCard('Active Lots', `${metrics.activeLots}`)}
        ${metricCard('Low Stock Alerts', `${metrics.lowStockAlerts}`, metrics.lowStockAlerts ? 'warning' : '')}
      </div>

      <div class="charts-grid">
        <article class="chart-card">
          <div class="chart-card-inner">
            <div class="chart-header">
              <span class="chart-title">Monthly Revenue</span>
              <span class="chart-meta">Last 6 months</span>
            </div>
            <div class="chart-headline" id="revenue-headline">&#8377;0</div>
            <div class="chart-canvas-wrap">
              <canvas id="chart-revenue"></canvas>
            </div>
            <div class="chart-legend">
              <div class="chart-legend-item">
                <div class="chart-legend-dot" style="background:#00e676"></div>
                Revenue
              </div>
            </div>
          </div>
        </article>

        <article class="chart-card">
          <div class="chart-card-inner">
            <div class="chart-header">
              <span class="chart-title">Cumulative Profit</span>
              <span class="chart-meta">Across all recorded sales</span>
            </div>
            <div class="chart-headline" id="profit-headline">&#8377;0</div>
            <div class="chart-canvas-wrap">
              <canvas id="chart-profit"></canvas>
            </div>
            <div class="chart-legend">
              <div class="chart-legend-item">
                <div class="chart-legend-dot" style="background:#00e676"></div>
                Profit
              </div>
            </div>
          </div>
        </article>

        <article class="chart-card">
          <div class="chart-card-inner">
            <div class="chart-header">
              <span class="chart-title">Top Products</span>
              <span class="chart-meta">By units sold</span>
            </div>
            <div class="chart-canvas-wrap chart-canvas-wrap--tall">
              <canvas id="chart-products"></canvas>
            </div>
          </div>
        </article>

        <article class="chart-card">
          <div class="chart-card-inner">
            <div class="chart-header">
              <span class="chart-title">Platform Breakdown</span>
              <span class="chart-meta">Units sold per channel</span>
            </div>
            <div class="chart-donut-layout">
              <div class="chart-donut-wrap">
                <canvas id="chart-platforms"></canvas>
              </div>
              <div class="chart-donut-legend" id="platform-legend"></div>
            </div>
          </div>
        </article>
      </div>
    </section>
  `;

  queueMicrotask(() => initCharts(state.sales));
  return {};
}
