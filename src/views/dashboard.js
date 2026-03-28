import { state } from '../state.js';
import {
  formatCurrency,
  formatDate,
  sumBy
} from '../utils/format.js';

let chartInstances = [];

function destroyCharts() {
  chartInstances.forEach((chart) => chart.destroy());
  chartInstances = [];
}

function getMetrics() {
  const totalRevenue = sumBy(state.sales, (sale) => Number(sale.sale_price || 0) * Number(sale.qty_sold || 0));
  const totalCost = sumBy(state.sales, (sale) => Number(sale.buy_price || 0) * Number(sale.qty_sold || 0));
  const totalProfit = totalRevenue - totalCost;
  const profitMargin = totalRevenue ? (totalProfit / totalRevenue) * 100 : 0;
  const unitsInStock = sumBy(
    state.inventory.filter((item) => item.status !== 'sold_out'),
    (item) => Number(item.quantity || 0)
  );
  const unitsSold = sumBy(state.sales, (sale) => Number(sale.qty_sold || 0));
  const activeLots = state.lots.filter((lot) => lot.status !== 'pushed').length;
  const lowStockAlerts = state.inventory.filter((item) => item.status === 'low_stock').length;

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

function buildMonthlyRevenue() {
  const now = new Date();
  const buckets = [];

  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    buckets.push({
      key,
      label: date.toLocaleString('en-IN', { month: 'short', year: '2-digit' }),
      total: 0
    });
  }

  state.sales.forEach((sale) => {
    const date = new Date(sale.date_sold);
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    const bucket = buckets.find((entry) => entry.key === key);
    if (bucket) {
      bucket.total += Number(sale.sale_price || 0) * Number(sale.qty_sold || 0);
    }
  });

  return buckets;
}

function buildCumulativeProfit() {
  const sales = [...state.sales].sort(
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

function buildTopProducts() {
  const groups = new Map();

  state.sales.forEach((sale) => {
    const key = sale.product_title;
    groups.set(key, (groups.get(key) || 0) + Number(sale.qty_sold || 0));
  });

  return Array.from(groups.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 5);
}

function buildPlatformBreakdown() {
  const groups = new Map();

  state.sales.forEach((sale) => {
    const key = sale.platform || 'Direct';
    groups.set(key, (groups.get(key) || 0) + Number(sale.qty_sold || 0));
  });

  return Array.from(groups.entries()).map(([label, value]) => ({ label, value }));
}

function initCharts() {
  destroyCharts();

  if (!window.Chart) {
    return;
  }

  window.Chart.defaults.font.family = "'DM Sans', system-ui, sans-serif";
  window.Chart.defaults.font.size = 11;
  window.Chart.defaults.color = '#666666';

  const monthlyRevenue = buildMonthlyRevenue();
  const cumulativeProfit = buildCumulativeProfit();
  const topProducts = buildTopProducts();
  const platformBreakdown = buildPlatformBreakdown();

  const chartConfigs = [
    {
      selector: '#dashboard-revenue',
      config: {
        type: 'bar',
        data: {
          labels: monthlyRevenue.map((entry) => entry.label),
          datasets: [
            {
              label: 'Revenue',
              data: monthlyRevenue.map((entry) => entry.total),
              backgroundColor: 'rgba(0, 230, 118, 0.20)',
              borderColor: '#00e676',
              borderWidth: 1.5,
              borderRadius: 4,
              borderSkipped: false
            }
          ]
        },
        options: baseChartOptions()
      }
    },
    {
      selector: '#dashboard-profit',
      config: {
        type: 'line',
        data: {
          labels: cumulativeProfit.map((entry) => entry.label),
          datasets: [
            {
              label: 'Cumulative Profit',
              data: cumulativeProfit.map((entry) => entry.value),
              borderColor: '#3d9eff',
              backgroundColor: 'rgba(61, 158, 255, 0.08)',
              tension: 0.35,
              fill: true,
              pointRadius: 3,
              pointBackgroundColor: '#3d9eff',
              borderWidth: 1.5
            }
          ]
        },
        options: baseChartOptions()
      }
    },
    {
      selector: '#dashboard-top-products',
      config: {
        type: 'bar',
        data: {
          labels: topProducts.map((entry) => entry.label),
          datasets: [
            {
              label: 'Units Sold',
              data: topProducts.map((entry) => entry.value),
              backgroundColor: 'rgba(240, 165, 0, 0.20)',
              borderColor: '#f0a500',
              borderWidth: 1.5,
              borderRadius: 4
            }
          ]
        },
        options: {
          ...baseChartOptions(),
          indexAxis: 'y'
        }
      }
    },
    {
      selector: '#dashboard-platforms',
      config: {
        type: 'doughnut',
        data: {
          labels: platformBreakdown.map((entry) => entry.label),
          datasets: [
            {
              data: platformBreakdown.map((entry) => entry.value),
              backgroundColor: [
                'rgba(0, 230, 118, 0.7)',
                'rgba(61, 158, 255, 0.7)',
                'rgba(232, 160, 32, 0.7)',
                'rgba(240, 62, 62, 0.7)',
                'rgba(128, 128, 128, 0.5)'
              ],
              borderColor: '#080808',
              borderWidth: 3
            }
          ]
        },
        options: {
          ...baseChartOptions(),
          cutout: '72%',
          scales: {}
        }
      }
    }
  ];

  chartConfigs.forEach(({ selector, config }) => {
    const canvas = document.querySelector(selector);
    if (!canvas) return;
    chartInstances.push(new window.Chart(canvas, config));
  });
}

function baseChartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      tooltip: {
        backgroundColor: '#141414',
        borderColor: 'rgba(255,255,255,0.08)',
        borderWidth: 1,
        titleColor: '#f0f0f0',
        bodyColor: '#808080',
        padding: 10,
        titleFont: {
          family: "'DM Sans', sans-serif",
          size: 12,
          weight: '600'
        },
        bodyFont: {
          family: "'DM Sans', sans-serif",
          size: 11
        },
        cornerRadius: 8
      },
      legend: {
        labels: {
          color: '#666666',
          font: {
            family: "'DM Sans', sans-serif",
            size: 11,
            weight: '500'
          },
          boxWidth: 10,
          boxHeight: 10,
          padding: 16,
          usePointStyle: true,
          pointStyle: 'circle'
        }
      }
    },
    scales: {
      x: {
        ticks: {
          color: '#555',
          font: {
            family: "'DM Sans', sans-serif",
            size: 10
          }
        },
        grid: {
          color: 'rgba(255,255,255,0.04)',
          drawBorder: false
        },
        border: {
          display: false
        }
      },
      y: {
        ticks: {
          color: '#555',
          font: {
            family: "'DM Sans', sans-serif",
            size: 10
          }
        },
        grid: {
          color: 'rgba(255,255,255,0.04)',
          drawBorder: false
        },
        border: {
          display: false
        }
      }
    }
  };
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

      <div class="dashboard-grid">
        <article class="chart-card">
          <div class="chart-header">
            <h3 class="chart-title">Monthly Revenue</h3>
            <span class="chart-subtitle">Last 6 months</span>
          </div>
          <div class="chart-canvas-wrap"><canvas id="dashboard-revenue"></canvas></div>
        </article>

        <article class="chart-card">
          <div class="chart-header">
            <h3 class="chart-title">Cumulative Profit</h3>
            <span class="chart-subtitle">Across all recorded sales</span>
          </div>
          <div class="chart-canvas-wrap"><canvas id="dashboard-profit"></canvas></div>
        </article>

        <article class="chart-card">
          <div class="chart-header">
            <h3 class="chart-title">Top Products</h3>
            <span class="chart-subtitle">By units sold</span>
          </div>
          <div class="chart-canvas-wrap"><canvas id="dashboard-top-products"></canvas></div>
        </article>

        <article class="chart-card">
          <div class="chart-header">
            <h3 class="chart-title">Platform Breakdown</h3>
            <span class="chart-subtitle">Units sold per channel</span>
          </div>
          <div class="chart-canvas-wrap"><canvas id="dashboard-platforms"></canvas></div>
        </article>
      </div>
    </section>
  `;

  queueMicrotask(initCharts);
  return {};
}
