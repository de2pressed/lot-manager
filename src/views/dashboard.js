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
              backgroundColor: '#00ff87aa',
              borderColor: '#00ff87',
              borderWidth: 1
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
              borderColor: '#4da6ff',
              backgroundColor: 'rgba(77, 166, 255, 0.16)',
              tension: 0.3,
              fill: true
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
              backgroundColor: '#ffaa00bb',
              borderColor: '#ffaa00',
              borderWidth: 1
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
              backgroundColor: ['#00ff87', '#4da6ff', '#ffaa00', '#ff4d4d', '#888888']
            }
          ]
        },
        options: {
          ...baseChartOptions(),
          plugins: {
            legend: {
              labels: {
                color: '#f0f0f0'
              }
            }
          }
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
      legend: {
        labels: {
          color: '#f0f0f0'
        }
      }
    },
    scales: {
      x: {
        ticks: {
          color: '#888888'
        },
        grid: {
          color: 'rgba(255,255,255,0.08)'
        }
      },
      y: {
        ticks: {
          color: '#888888'
        },
        grid: {
          color: 'rgba(255,255,255,0.08)'
        }
      }
    }
  };
}

function metricCard(label, value, tone = '') {
  return `
    <article class="metric-card ${tone}">
      <span>${label}</span>
      <strong>${value}</strong>
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

      <div class="metrics-grid">
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
        <article class="panel-card">
          <div class="panel-head">
            <h3>Monthly Revenue</h3>
            <span>Last 6 months</span>
          </div>
          <div class="chart-wrap"><canvas id="dashboard-revenue"></canvas></div>
        </article>

        <article class="panel-card">
          <div class="panel-head">
            <h3>Cumulative Profit</h3>
            <span>Across all recorded sales</span>
          </div>
          <div class="chart-wrap"><canvas id="dashboard-profit"></canvas></div>
        </article>

        <article class="panel-card">
          <div class="panel-head">
            <h3>Top Products</h3>
            <span>By units sold</span>
          </div>
          <div class="chart-wrap"><canvas id="dashboard-top-products"></canvas></div>
        </article>

        <article class="panel-card">
          <div class="panel-head">
            <h3>Platform Breakdown</h3>
            <span>Units sold per channel</span>
          </div>
          <div class="chart-wrap"><canvas id="dashboard-platforms"></canvas></div>
        </article>
      </div>
    </section>
  `;

  queueMicrotask(initCharts);
  return {};
}
